import { MAX_MCP_OUTPUT_BYTES } from "../../core/constants.ts";
import { formatMiB } from "../../core/format.ts";
import type { McpContentPart } from "../../core/types.ts";

export function renderMcpContent(content: McpContentPart[] | undefined, tool: string): string {
	if (!content || content.length === 0) return "(no content)";
	const parts: string[] = [];
	for (const part of content) {
		if (part.type === "text" && part.text) {
			parts.push(part.text);
		} else if (part.type === "image" && part.data) {
			parts.push(`![image](data:${part.mimeType ?? "image/png"};base64,${part.data})`);
		} else if (part.type === "audio" && part.data) {
			parts.push(`[audio](data:${part.mimeType ?? "audio/mpeg"};base64,${part.data})`);
		} else {
			parts.push(JSON.stringify(part));
		}
	}
	const joined = parts.join("\n\n");
	// A plan can't tell cut output from whole output, so fail (the bridge turns
	// this into an mcp.<tool> rejection) and let it ask the tool for less.
	const bytes = Buffer.byteLength(joined, "utf8");
	if (bytes > MAX_MCP_OUTPUT_BYTES) {
		throw new Error(
			`${tool} returned ${formatMiB(bytes)} MiB, over the ${formatMiB(MAX_MCP_OUTPUT_BYTES)} MiB limit for mcp output. Ask the tool for less, e.g. a smaller maxCharacters or numResults, or fewer urls per call.`,
		);
	}
	return joined;
}
