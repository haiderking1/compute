import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executePlan } from "./testing/execute.ts";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function temporary() {
  const path = await mkdtemp(join(tmpdir(), "pi-compute-validation-test-"));
  directories.push(path);
  return path;
}

test("artifact IO failures retain the completed-call trace and warn against replaying side effects", async () => {
  const cwd = await temporary();
  const result = await executePlan(cwd, `async () => {
    await system.exec({ argv: ["sh", "-c", "printf x >> counter"] });
    return "saved?".repeat(2000);
  }`, { TMPDIR: join(cwd, "missing-temporary-directory") });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("Plan completed, but saving its oversized result failed");
  expect(result.content[0].text).toContain("Do not rerun the plan blindly");
  expect(result.details.codeModeCalls).toHaveLength(1);
  expect(result.details.codeModeOutput).toBeUndefined();
  expect(await readFile(join(cwd, "counter"), "utf8")).toBe("x");
}, 20000);

test("code size validation counts UTF-8 bytes before executing a plan", async () => {
  const cwd = await temporary();
  const code = "async () => " + JSON.stringify("مرحبا".repeat(12000));
  expect(code.length).toBeLessThan(100000);
  const result = await executePlan(cwd, code);
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("code is too large (" + Buffer.byteLength(code) + " bytes)");
  expect(result.details).toBeNull();
}, 20000);
