import { expect, test } from "bun:test";
import { MAX_MCP_OUTPUT_BYTES } from "../../core/constants.ts";
import { renderMcpContent } from "./content.ts";

test("output well past the old 200 KB cap comes back whole", () => {
	const text = "w".repeat(1_000_000);
	expect(renderMcpContent([{ type: "text", text }], "web_fetch_exa")).toBe(text);
});

test("parts are joined, and output at the limit is still returned", () => {
	const half = "h".repeat(MAX_MCP_OUTPUT_BYTES / 2 - 1);
	expect(renderMcpContent([{ type: "text", text: half }, { type: "text", text: half }], "t")).toHaveLength(MAX_MCP_OUTPUT_BYTES);
});

test("output over the limit fails with the size and how to ask for less", () => {
	// Two-byte characters: under the limit in characters, over it in bytes.
	const text = "é".repeat(MAX_MCP_OUTPUT_BYTES / 2 + 1);
	expect(() => renderMcpContent([{ type: "text", text }], "web_fetch_exa")).toThrow(
		"web_fetch_exa returned 4.01 MiB, over the 4 MiB limit for mcp output. Ask the tool for less",
	);
});
