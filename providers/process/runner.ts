import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { constants } from "node:os";
import { MAX_STREAM_BYTES, PIPE_DRAIN_GRACE_MS } from "../../core/constants.ts";
import type { ProcessOutcome } from "../../core/types.ts";

async function readStream(stream: NodeJS.ReadableStream | undefined, cap: number): Promise<string> {
	if (!stream) return "";
	let out = "";
	let truncated = false;
	try {
		for await (const chunk of stream as AsyncIterable<Buffer>) {
			out += chunk.toString("utf8");
			if (out.length > cap) {
				out = out.slice(0, cap);
				truncated = true;
				break;
			}
		}
	} catch {
		/* ignore read errors */
	}
	if (truncated) {
		(stream as { destroy?: () => void }).destroy?.();
		out += "\n[truncated]";
	}
	return out;
}

/** Kill an entire process group by its leader pid (setsid + killpg). */
export function killGroupPid(pid: number | undefined): void {
	if (pid === undefined) return;
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		/* no such group (already fully reaped) */
	}
}

export function killProcessGroup(proc: import("node:child_process").ChildProcess): void {
	killGroupPid(proc.pid);
	try {
		proc.kill("SIGKILL");
	} catch {
		/* ignore */
	}
}
/**
 * Node reports a missing cwd as `spawn <program> ENOENT`, which reads as if
 * the program were missing. Name the directory instead.
 */
function describeSpawnError(error: unknown, cwd: string): unknown {
	if ((error as NodeJS.ErrnoException)?.code === "ENOENT" && !existsSync(cwd)) {
		return new Error(`working directory does not exist: ${cwd}`);
	}
	return error;
}

export async function runProcess(
	argv: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number; signal?: AbortSignal; execGroups: Set<number> },
): Promise<ProcessOutcome> {
	// `detached: true` makes the child a process-group leader so a single
	// negative-pid signal reaps the process and every descendant (Raid's
	// setsid + killpg).
	let proc: import("node:child_process").ChildProcess;
	try {
		proc = spawn(argv[0], argv.slice(1), {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		});
	} catch (error) {
		// Bun throws spawn failures synchronously; Node emits them as "error".
		throw describeSpawnError(error, options.cwd);
	}
	// Register the group leader pid so a shell that exits while leaving a
	// background job (reparented to init but still in this pgid) is still
	// reaped when the compute plan is cancelled or times out.
	if (proc.pid !== undefined) options.execGroups.add(proc.pid);

	// Attach the exit listener immediately. A fast command can exit before we
	// finish draining pipes; attaching `once("exit")` only afterwards misses
	// the event and the await hangs forever.
	// A spawn failure (missing binary, bad cwd) emits "error" instead of "exit";
	// unhandled, it crashes the server. Keep a permanent listener so a late
	// "error" cannot crash it either.
	// A signal death reports the shell convention 128 + signal number (137 for
	// SIGKILL) rather than a generic failure.
	const exitPromise = new Promise<number>((resolveExit, rejectExit) => {
		proc.once("exit", (code, exitSignal) =>
			resolveExit(code ?? (exitSignal ? 128 + (constants.signals[exitSignal] ?? 0) : 1)),
		);
		proc.on("error", (error) => rejectExit(describeSpawnError(error, options.cwd)));
	});
	const stdoutPromise = readStream(proc.stdout, MAX_STREAM_BYTES);
	const stderrPromise = readStream(proc.stderr, MAX_STREAM_BYTES);

	let timer: ReturnType<typeof setTimeout> | undefined;
	const kill = () => killProcessGroup(proc);
	const onAbort = () => kill();
	if (options.signal) options.signal.addEventListener("abort", onAbort, { once: true });
	let timedOut = false;
	if (options.timeoutMs !== undefined) {
		timer = setTimeout(() => {
			timedOut = true;
			kill();
		}, options.timeoutMs);
	}

	try {
		const exitCode = await exitPromise;
		// Wait for the pipes to drain, but give a descendant that inherited the
		// descriptors a short grace before tearing them down (Raid's
		// PIPE_DRAIN_GRACE). Reap the group if a descendant is still holding the
		// pipe so nothing leaks as an orphan.
		const [stdout, stderr] = await Promise.race([
			Promise.all([stdoutPromise, stderrPromise]),
			new Promise<void>((resolveGrace) => setTimeout(resolveGrace, PIPE_DRAIN_GRACE_MS)).then(async () => {
				killProcessGroup(proc);
				proc.stdout?.destroy();
				proc.stderr?.destroy();
				return Promise.all([stdoutPromise, stderrPromise]);
			}),
		]);
		return timedOut ? { exitCode, stdout, stderr, timedOut: true } : { exitCode, stdout, stderr };
	} finally {
		if (proc.pid !== undefined) options.execGroups.delete(proc.pid);
		if (timer) clearTimeout(timer);
		if (options.signal) options.signal.removeEventListener("abort", onAbort);
	}
}
