import { MAX_STREAM_BYTES } from "../../core/constants.ts";
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
	return joined.length > MAX_STREAM_BYTES
		? `${joined.slice(0, MAX_STREAM_BYTES)}\n[truncated: ${tool} output exceeded ${MAX_STREAM_BYTES} bytes]`
		: joined;
}
