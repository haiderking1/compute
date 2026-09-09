import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { ProviderCallError, formatPlanError } from "./errors.mjs";

test("provider errors retain identity through allSettled and JSON", async () => {
  const results = await Promise.allSettled([Promise.resolve(42), Promise.reject(new ProviderCallError("workspace", "read", "missing file"))]);
  expect(JSON.parse(JSON.stringify(results))).toEqual([
    { status: "fulfilled", value: 42 },
    { status: "rejected", reason: { name: "ProviderCallError", provider: "workspace", method: "read", message: "missing file" } },
  ]);
});

test("cross-realm errors report source locations without dumping host stacks", () => {
  let error: unknown;
  try { runInNewContext("\n\n\nmissingVariable", {}, { filename: "compute-plan.js" }); }
  catch (caught) { error = caught; }
  expect(formatPlanError(error)).toContain("ReferenceError: missingVariable is not defined");
  expect(formatPlanError(error)).toContain("[plan line 2]");
  expect(formatPlanError(error)).not.toContain("node:vm");
});

test("error bounds count UTF-8 bytes and lines", () => {
  const text = formatPlanError(new Error("😀".repeat(20000)));
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(16 * 1024);
  expect(text).toEndWith("[error truncated]");
  expect(text).not.toContain("�");
  expect(formatPlanError(new Error("line\n".repeat(80))).split("\n").length).toBeLessThanOrEqual(40);
});
