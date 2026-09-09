import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

export function toolText(text: string, details?: unknown): AgentToolResult {
	return { content: [{ type: "text", text }], details: details ?? null };
}

export function toolValue(value: unknown): AgentToolResult {
	// `content` is empty and `details.codeModeValue` carries the raw value; the
	// worker's invoke() unwraps it so the plan receives the concrete value.
	return { content: [], details: { codeModeValue: value } as unknown };
}

export function toolError(text: string, details?: unknown): AgentToolResult {
	return { content: [{ type: "text", text }], details: details ?? null, isError: true };
}

