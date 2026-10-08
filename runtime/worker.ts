import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { MEMORY_LIMIT_BYTES } from "../core/constants.ts";
import type { MethodEnv } from "../core/types.ts";
import { getProviders } from "../providers/catalog.ts";
import { killGroupPid, killProcessGroup } from "../providers/process/runner.ts";
import { resolveProviderCall } from "./bridge.ts";
import { ComputeTrace } from "./trace.ts";
import { workerPath } from "./worker-path.ts";

export { workerPath } from "./worker-path.ts";

function nodeBinary(): string {
	const override = process.env.PI_COMPUTE_NODE;
	if (override) return override;
	return process.execPath;
}

// ---------------------------------------------------------------------------
// Worker driver
// ---------------------------------------------------------------------------

export async function runWorker(
	code: string,
	timeoutSeconds: number | undefined,
	cwd: string,
	signal: AbortSignal | undefined,
	trace: ComputeTrace,
	model?: { input?: string[] } | undefined,
): Promise<string> {
	// One AbortController drives every cancellation path, exactly like Raid's
	// accumulate-into-one-cancel-token design. Feeding BOTH the session abort
	// signal AND the optional compute timeout into a single signal guarantees
	// that cancelling or timing out the plan kills the worker process group AND
	// any in-flight system.exec process group at the same moment.
	const internalAbort = new AbortController();
	const providerSignal = internalAbort.signal;
	let abortReason: "interrupt" | "timeout" = "interrupt";

	// Registry of every system.exec process-group leader spawned by this plan.
	// The exec child is a direct child of this (parent) process, NOT of the
	// worker, so killing the worker group never reaches it. We drain this
	// registry on cancel/timeout so the entire exec process tree is reaped.
	const execGroups = new Set<number>();
	const env: MethodEnv = { cwd, signal: providerSignal, execGroups, model };

	// `detached: true` makes the worker a process-group leader so a single
	// negative-pid signal reaps the worker and everything it spawned (Raid's
	// setsid + killpg).
	const child = spawn(nodeBinary(), ["--max-old-space-size=128", workerPath()], {
		stdio: ["pipe", "pipe", "pipe"],
		detached: true,
	});

	const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

	// Both listeners must exist before any await or early return. A spawn
	// failure emits "error" and never "exit", and stdout may never end:
	// unhandled it crashes the server, and unresolved it hangs the plan. A
	// write to a worker that already died emits an async EPIPE on stdin that
	// the try/catch around write() misses; the exit path below reports the
	// death instead.
	const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
		child.once("exit", (code, exitSignal) => resolveExit({ code, signal: exitSignal }));
		child.on("error", (error) => {
			settle(new Error(`Could not start compute worker: ${error.message}`));
			rl.close();
			resolveExit({ code: null, signal: null });
		});
	});
	child.stdin.on("error", () => {});

	let stderrBuf = "";
	child.stderr.on("data", (chunk) => {
		stderrBuf += chunk.toString("utf8");
		if (stderrBuf.length > 16 * 1024) stderrBuf = stderrBuf.slice(-16 * 1024);
	});

	let settled = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let resolveDone!: (value: string) => void;
	let rejectDone!: (error: Error) => void;
	const done = new Promise<string>((resolve, reject) => {
		resolveDone = resolve;
		rejectDone = reject;
	});
	// Mark the rejection as handled immediately so Node does not emit an
	// unhandled-rejection error in the window before the caller's `await`
	// attaches. The caller (`execute`) still receives the rejection and turns
	// it into an error tool result.
	done.catch(() => {});

	const onExternalAbort = () => internalAbort.abort();
	const settle = (error?: Error, output?: string) => {
		if (settled) return;
		settled = true;
		if (timer) clearTimeout(timer);
		if (signal) signal.removeEventListener("abort", onExternalAbort);
		if (error) {
			// Reap the exec process tree (the real source of orphans) before the
			// worker. Surviving shell background jobs stay in their group leader's
			// pgid even after the shell is reparented to init, so killGroupPid
			// reclaims them.
			for (const pid of execGroups) killGroupPid(pid);
			execGroups.clear();
			killProcessGroup(child);
			rejectDone(error);
		} else {
			execGroups.clear();
			// Let the worker exit naturally after EOF instead of killing it.
			try {
				child.stdin.end();
			} catch {
				/* ignore */
			}
			resolveDone(output ?? "");
		}
	};

	// Drive cancellation from either the session abort signal or the timeout.
	internalAbort.signal.addEventListener("abort", () => {
		if (abortReason === "timeout") {
			settle(new Error(`compute timed out after ${timeoutSeconds} seconds`));
		} else {
			settle(new Error("Operation aborted"));
		}
	});
	if (signal) signal.addEventListener("abort", onExternalAbort, { once: true });
	if (timeoutSeconds && timeoutSeconds > 0) {
		timer = setTimeout(() => {
			abortReason = "timeout";
			internalAbort.abort();
		}, timeoutSeconds * 1000);
	}

	try {
		child.stdin.write(
			`${JSON.stringify({
				type: "start",
				code,
				providers: getProviders().map((provider) => ({ name: provider.name, methods: provider.methods.map((m) => m.name) })),
				cwd,
			})}\n`,
		);
	} catch (error) {
		settle(new Error(`Could not start compute worker: ${error instanceof Error ? error.message : String(error)}`));
		return done;
	}

	const handleLine = (line: string) => {
		if (settled) return;
		let message: unknown;
		try {
			message = JSON.parse(line);
		} catch {
			return;
		}
		const msg = message as {
			type?: string;
			id?: number;
			provider?: string;
			method?: string;
			args?: unknown;
			output?: string;
			error?: string;
		};
		if (msg.type === "call") {
			void resolveProviderCall(msg.provider!, msg.method!, (msg.args as Record<string, unknown>) ?? {}, env, trace)
				.then((envelope) => {
					if (settled) return;
					try {
						child.stdin.write(`${JSON.stringify({ type: "call-result", id: msg.id, envelope })}\n`);
					} catch {
						/* EPIPE when the worker already exited */
					}
				})
				.catch(() => {
					/* ignore */
				});
		} else if (msg.type === "complete") {
			settle(undefined, msg.output ?? "");
		} else if (msg.type === "failed") {
			settle(new Error(`compute failed: ${msg.error || "unknown JavaScript error"}`));
		}
	};

	const lineLoop = (async () => {
		try {
			for await (const line of rl) handleLine(line);
		} catch (error) {
			settle(new Error(`compute worker output failed: ${error instanceof Error ? error.message : String(error)}`));
		} finally {
			rl.close();
		}
	})();

	const [{ code: exitCode }] = await Promise.all([exitPromise, lineLoop]);

	if (!settled) {
		// Distinguish the V8 heap cap from other crashes so the model gets an
		// actionable message instead of a GC log dump.
		const outOfMemory = /heap out of memory|Allocation failed - JavaScript heap|Last few GCs/i.test(stderrBuf);
		const detail = stderrBuf.trim().slice(0, 1000);
		settle(
			outOfMemory
				? new Error(
						`compute exceeded the worker memory budget (${Math.round(
							MEMORY_LIMIT_BYTES / (1024 * 1024),
						)} MiB soft limit, hard V8 cap). Return less data from the plan.`,
					)
					: new Error(`compute worker exited unexpectedly (code ${exitCode})${detail ? `: ${detail}` : ""}`),
			);
	}

	return done;
}
