/**
 * Raid parity: decode_nested_result (mod.rs). A plan that returns the
 * __computeToolResult envelope — produced by the sandbox bridge whenever a
 * provider tool call's result carries image content — is decoded into the
 * real tool result so image blocks reach the model instead of base64 text.
 */
export function decodeNestedResult(output: string): {
	content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
	details: unknown;
	isError: boolean;
} | null {
	let value: unknown;
	try {
		value = JSON.parse(output);
	} catch {
		return null;
	}
	if (!value || typeof value !== "object") return null;
	const wrapper = value as Record<string, unknown>;
	if (wrapper.__computeToolResult !== true) return null;
	const result = wrapper.result;
	if (!result || typeof result !== "object") return null;
	const record = result as Record<string, unknown>;
	if (!Array.isArray(record.content)) return null;
	const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
	for (const part of record.content) {
		if (!part || typeof part !== "object") continue;
		const block = part as Record<string, unknown>;
		if (block.type === "text" && typeof block.text === "string") {
			content.push({ type: "text", text: block.text });
		} else if (block.type === "image" && typeof block.data === "string") {
			content.push({
				type: "image",
				data: block.data,
				mimeType: typeof block.mimeType === "string" ? block.mimeType : "image/png",
			});
		}
	}
	return {
		content,
		details: "details" in record ? (record.details ?? null) : null,
		isError: record.isError === true || record.is_error === true,
	};
}

/**
 * Raid only decodes a TOP-LEVEL tool-result envelope. That is too
 * brittle for composed plans — a model that returns
 * { screenshot: await read(png), log: lines } nests the envelope and the
 * base64 would flow back as text (and trip the output guard). Hoist every
 * envelope found anywhere in the returned structure: images attach to the
 * tool result natively, and the envelope collapses to its text note in the
 * serialized view. Depth- and count-capped so a hostile plan cannot flood
 * the context with images.
 */
const MAX_HOISTED_IMAGES = 8;
const MAX_HOIST_DEPTH = 6;

export function hoistImageEnvelopes(
	value: unknown,
	images: Array<{ type: "image"; data: string; mimeType: string }>,
	depth: number,
): unknown {
	if (depth > MAX_HOIST_DEPTH) return value;
	if (Array.isArray(value)) return value.map((item) => hoistImageEnvelopes(item, images, depth + 1));
	if (!value || typeof value !== "object") return value;
	const record = value as Record<string, unknown>;
	if (record.__computeToolResult === true && record.result && typeof record.result === "object") {
		const result = record.result as Record<string, unknown>;
		const content = Array.isArray(result.content) ? result.content : [];
		const texts: string[] = [];
		for (const part of content) {
			if (!part || typeof part !== "object") continue;
			const block = part as Record<string, unknown>;
			if (block.type === "image" && typeof block.data === "string") {
				if (images.length < MAX_HOISTED_IMAGES) {
					images.push({
						type: "image",
						data: block.data,
						mimeType: typeof block.mimeType === "string" ? block.mimeType : "image/png",
					});
				}
			} else if (block.type === "text" && typeof block.text === "string") {
				texts.push(block.text);
			}
		}
		return texts.join("\n");
	}
	const copy: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(record)) {
		copy[key] = hoistImageEnvelopes(item, images, depth + 1);
	}
	return copy;
}

/** Port of Raid trace::merge_trace_details: trace keys extend the details object. */
export function mergeTraceDetails(details: unknown, trace: unknown): unknown {
	if (!trace || typeof trace !== "object") return details;
	const traceRecord = trace as Record<string, unknown>;
	if (details === null || details === undefined) return { ...traceRecord };
	if (typeof details === "object") return { ...(details as Record<string, unknown>), ...traceRecord };
	return { toolDetails: details, ...traceRecord };
}
