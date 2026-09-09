import { Type } from "typebox";
import { MAX_CODE_BYTES, MAX_TIMEOUT_SECONDS } from "../core/constants.ts";
import { formatOutput } from "../results/output.ts";
import { toolError } from "../results/tool-result.ts";
import { ComputeTrace } from "../runtime/trace.ts";
import { runWorker } from "../runtime/worker.ts";
import { renderComputeCall, renderComputeResult } from "../ui/renderers.ts";
import { buildComputeDescription } from "./description.ts";

export function makeComputeToolDefinition() {
	return {
		name: "compute",
		label: "Compute",
		renderShell: "self" as const,
		description: buildComputeDescription(),
		promptSnippet: "Run one isolated JavaScript plan composing workspace, system, and raid providers, returning only the final value",
		promptGuidelines: [
			"Prefer compute for any multi-step file, search, or process work instead of many separate read/bash/write calls.",
			"Write a single async arrow function that loops, branches, filters, and shapes results inside the plan.",
			"Return the smallest useful value (a slice, a summary, a boolean). Do not dump large arrays back to the model.",
			"For independent calls that can fail separately, use Promise.allSettled and retain only needed fulfilled values and provider error messages. Check system.exec exitCode separately.",
			"If output was saved to a temporary file, read or filter that file. Do not rerun a completed plan to recover its output, especially if it changed files.",
			"compute is the only callable tool — provider methods like raid.web_search_exa are globals inside compute plans, never tool names; calling one directly fails with 'Tool not found'.",
			"system.exec takes an exact argv array with no shell; raid.bash runs a shell command string; raid.* also exposes web search/fetch tools.",
			"Always set title to a short one-line summary of the plan's action — the user sees it instead of the code.",
		],
		renderCall: renderComputeCall,
		renderResult: renderComputeResult,
		parameters: Type.Object(
			{
				title: Type.String({
					minLength: 1,
					maxLength: 120,
					description:
						"One-line imperative summary of what this plan does, shown to the user in the tool UI instead of the code. e.g. 'Find where compute validates tool args'.",
				}),
				code: Type.String({
					description:
						"An async JavaScript arrow function that calls the declared providers and returns the smallest useful result.",
				}),
				timeout: Type.Optional(
					Type.Integer({
						minimum: 1,
						maximum: MAX_TIMEOUT_SECONDS,
						description:
							"Optional hard deadline in seconds. Without it, the plan runs until completion or interruption.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(
			_toolCallId: string,
			params: { title?: string; code?: string; timeout?: number },
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: { cwd: string; model?: { input?: string[] } },
		) {
			const cwd = ctx.cwd;

			if (signal?.aborted) {
				return toolError("Operation aborted");
			}

			const title = typeof params.title === "string" ? params.title.trim() : "";
			if (!title) {
				return toolError(
					'title is required: give a one-line summary of this plan’s action (max 120 chars) — it is shown to the user in the tool UI instead of the code.',
				);
			}
			if (title.length > 120) {
				return toolError(`title is too long (${title.length} chars, max 120). Keep it to one line.`);
			}

			const code = (params.code ?? "").trim();
			if (!code) return toolError("code must be a non-empty string.");
			const codeBytes = Buffer.byteLength(code, "utf8");
			if (codeBytes > MAX_CODE_BYTES) {
				return toolError(`code is too large (${codeBytes} bytes). Keep it under ${MAX_CODE_BYTES} bytes.`);
			}

			let timeout: number | undefined;
			if (params.timeout !== undefined) {
				if (!Number.isInteger(params.timeout) || params.timeout <= 0) {
					return toolError("timeout must be a positive integer.");
				}
				if (params.timeout > MAX_TIMEOUT_SECONDS) {
					return toolError(`timeout must be at most ${MAX_TIMEOUT_SECONDS} seconds.`);
				}
				timeout = params.timeout;
			}

			const trace = new ComputeTrace();
			let output: string;
			try {
				output = await runWorker(code, timeout, cwd, signal, trace, ctx.model);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				// Raid maps its NOT_SERIALIZABLE marker to a friendly message.
				return toolError(
					message.includes("__RAID_COMPUTE_NOT_SERIALIZABLE__")
						? "compute result is not JSON-serializable. Return a plain value."
						: message,
					trace.details(),
				);
			}

			return formatOutput(output, trace.details());
		},
	};
}
