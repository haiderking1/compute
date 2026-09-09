import { describe, expect, test } from "bun:test";
import { decodeNestedResult, hoistImageEnvelopes, mergeTraceDetails } from "./nested.ts";

function envelope(text: string, data: string, mimeType?: string) {
	return {
		__computeToolResult: true,
		result: {
			content: [
				{ type: "text", text },
				{ type: "image", data, ...(mimeType ? { mimeType } : {}) },
			],
			details: { source: "read" },
		},
	};
}

describe("nested results", () => {
	test("decodes a top-level image result and defaults its MIME type", () => {
		const decoded = decodeNestedResult(JSON.stringify(envelope("image note", "YWJj")));
		expect(decoded).toEqual({
			content: [
				{ type: "text", text: "image note" },
				{ type: "image", data: "YWJj", mimeType: "image/png" },
			],
			details: { source: "read" },
			isError: false,
		});
	});

	test("rejects ordinary and malformed wrappers", () => {
		expect(decodeNestedResult("not json")).toBeNull();
		expect(decodeNestedResult(JSON.stringify({ __computeToolResult: true, result: {} }))).toBeNull();
		expect(decodeNestedResult(JSON.stringify({ result: { content: [] } }))).toBeNull();
	});

	test("hoists images from nested objects and arrays while retaining text", () => {
		const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
		const value = { screenshot: envelope("screen", "AAA", "image/jpeg"), items: [envelope("thumb", "BBB")] };
		expect(hoistImageEnvelopes(value, images, 0)).toEqual({ screenshot: "screen", items: ["thumb"] });
		expect(images).toEqual([
			{ type: "image", data: "AAA", mimeType: "image/jpeg" },
			{ type: "image", data: "BBB", mimeType: "image/png" },
		]);
	});

	test("caps hoisted images and merges trace details without dropping tool details", () => {
		const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
		hoistImageEnvelopes(Array.from({ length: 10 }, (_, index) => envelope(String(index), String(index))), images, 0);
		expect(images).toHaveLength(8);
		expect(mergeTraceDetails("opaque", { codeModeCalls: [1] })).toEqual({
			toolDetails: "opaque",
			codeModeCalls: [1],
		});
	});
});
