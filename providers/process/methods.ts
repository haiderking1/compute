import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { MethodEnv } from "../../core/types.ts";
import { toolError, toolValue } from "../../results/tool-result.ts";
import { resolveWorkspacePath } from "../workspace/paths.ts";
import { runProcess } from "./runner.ts";

export async function runSystemExec(args: Record<string, unknown>, env: MethodEnv): Promise<AgentToolResult> {
	const argv = Array.isArray(args.argv) ? args.argv.map(String) : [];
	if (argv.length === 0) return toolError("exec(argv) requires a non-empty array of strings.");
	if (argv.some((argument) => argument.includes("\0"))) {
		return toolError("exec(argv) requires a non-empty array of strings without NUL bytes.");
	}
	const timeoutMs = typeof args.timeout === "number" && args.timeout > 0 ? args.timeout * 1000 : undefined;
	try {
		const outcome = await runProcess(argv, {
			cwd: env.cwd,
			env: process.env,
			timeoutMs,
			signal: env.signal,
			execGroups: env.execGroups,
		});
		return toolValue(outcome);
	} catch (error) {
		return toolError(error instanceof Error ? error.message : String(error));
	}
}

// ---------------------------------------------------------------------------
// system.bash runs a shell command, unlike the exact argv API in system.exec.
export async function runSystemBash(args: Record<string, unknown>, env: MethodEnv): Promise<AgentToolResult> {
	const command = String(args.command ?? "");
	if (!command.trim()) return toolError("bash requires a non-empty command.");
	const timeoutMs = typeof args.timeout === "number" && args.timeout > 0 ? args.timeout * 1000 : undefined;
	const cwd = args.cwd ? resolveWorkspacePath(String(args.cwd), env.cwd) : env.cwd;
	const envOverrides =
		args.env && typeof args.env === "object" ? (args.env as Record<string, string>) : undefined;
	try {
		const outcome = await runProcess(["bash", "-lc", command], {
			cwd,
			env: envOverrides ? { ...process.env, ...envOverrides } : process.env,
			timeoutMs,
			signal: env.signal,
			execGroups: env.execGroups,
		});
		return toolValue(outcome);
	} catch (error) {
		return toolError(error instanceof Error ? error.message : String(error));
	}
}
