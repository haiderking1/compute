import { describe, expect, test } from "bun:test";
import { applyFileReplacements, applyReplacements } from "./edits.ts";

describe("workspace edit replacements", () => {
	test("applies disjoint replacements against the original content", () => {
		expect(
			applyReplacements(
				"alpha beta gamma",
				[
					{ oldText: "alpha", newText: "A" },
					{ oldText: "gamma", newText: "G" },
				],
				"sample.txt",
			),
		).toBe("A beta G");
	});

	test("rejects nonunique and overlapping replacements", () => {
		expect(() => applyReplacements("same same", [{ oldText: "same", newText: "x" }], "sample.txt")).toThrow(
			"Found 2 occurrences",
		);
		expect(() =>
			applyReplacements(
				"abcdef",
				[
					{ oldText: "abcd", newText: "x" },
					{ oldText: "cdef", newText: "y" },
				],
				"sample.txt",
			),
		).toThrow("overlap in sample.txt");
	});

	test("preserves a UTF-8 BOM and CRLF line endings", () => {
		const result = applyFileReplacements(
			"\ufefffirst\r\nsecond\r\n",
			[{ oldText: "second\n", newText: "changed\n" }],
			"sample.txt",
		);
		expect(result.normalized).toBe("first\nsecond\n");
		expect(result.updated).toBe("first\nchanged\n");
		expect(result.finalContent).toBe("\ufefffirst\r\nchanged\r\n");
	});
});
