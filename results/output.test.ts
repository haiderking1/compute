import { afterEach, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { INLINE_OUTPUT_MAX_BYTES } from "../core/constants.ts";
import { formatOutput } from "./output.ts";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function rendered(text: string, trace: unknown = null) {
  const result = await formatOutput(text, trace);
  const details = result.details as { codeModeOutput?: { path: string } } | null;
  if (details?.codeModeOutput) directories.push(dirname(details.codeModeOutput.path));
  return result;
}

test("inline boundary is measured in UTF-8 bytes and the line limit applies independently", async () => {
  const text = "é".repeat(INLINE_OUTPUT_MAX_BYTES / 2);
  expect((await rendered(text)).content).toEqual([{ type: "text", text }]);
  for (const oversized of [text + "é", "\n".repeat(2000), "😀".repeat(10000)]) {
    const result = await rendered(oversized);
    const saved = (result.details as any).codeModeOutput;
    expect(saved.truncated).toBe(true);
    expect(Buffer.byteLength((result.content[0] as { text: string }).text)).toBeLessThan(INLINE_OUTPUT_MAX_BYTES);
    expect(await readFile(saved.path, "utf8")).toBe(oversized);
  }
});

test("JSON results beyond the former hard limit remain complete in the saved artifact", async () => {
  const original = JSON.stringify({ value: "x".repeat(600000), last: "not lost" });
  const result = await rendered(original, { codeModeCalls: [{ provider: "system", method: "exec", is_error: false }] });
  const details = result.details as any;
  expect(result.isError).not.toBe(true);
  expect(details.codeModeCalls).toHaveLength(1);
  expect(JSON.parse(await readFile(details.codeModeOutput.path, "utf8"))).toEqual(JSON.parse(original));
  expect(JSON.stringify(result.content).length).toBeLessThan(8000);
});

test("oversized nested and top-level image results retain attachments, error state, and trace", async () => {
  const image = { type: "image", data: "aW1hZ2U=", mimeType: "image/png" };
  const envelope = { __raidToolResult: true, result: { content: [{ type: "text", text: "x".repeat(9000) }, image], details: { source: "fixture" }, isError: true } };
  for (const value of [envelope, { screenshot: envelope }]) {
    const result = await rendered(JSON.stringify(value), { codeModeCalls: [{ provider: "workspace", method: "read", is_error: false }] });
    expect(result.content[1]).toEqual(image);
    const details = result.details as any;
    expect(details.codeModeCalls).toHaveLength(1);
    expect(await readFile(details.codeModeOutput.path, "utf8")).not.toContain(image.data);
    if (value === envelope) { expect(result.isError).toBe(true); expect(details.source).toBe("fixture"); }
  }
});
