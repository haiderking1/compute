import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { executePlan } from "./testing/execute.ts";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function temporary() {
  const path = await mkdtemp(join(tmpdir(), "pi-compute-recovery-test-"));
  directories.push(path);
  return path;
}

test("independent provider failures preserve successful results with serializable reasons", async () => {
  const cwd = await temporary();
  const result = await executePlan(cwd, `async () => {
    return Promise.allSettled([
      system.exec({ argv: ["printf", "kept"] }),
      workspace.read({ path: "missing.txt" })
    ]);
  }`);
  expect(result.isError).not.toBe(true);
  const values = JSON.parse(result.content[0].text);
  expect(values[0]).toEqual({ status: "fulfilled", value: { exitCode: 0, stdout: "kept", stderr: "" } });
  expect(values[1].status).toBe("rejected");
  expect(values[1].reason).toMatchObject({ name: "ProviderCallError", provider: "workspace", method: "read" });
  expect(values[1].reason.message).toContain("missing.txt");
  expect(result.details.codeModeCalls.some((call: { is_error: boolean }) => call.is_error)).toBe(true);
}, 20000);

test("uncaught provider and JavaScript errors identify their plan lines", async () => {
  const cwd = await temporary();
  const provider = await executePlan(cwd, "async () => {\n  return await workspace.read({ path: \"missing.txt\" });\n}");
  expect(provider.isError).toBe(true);
  expect(provider.content[0].text).toContain("workspace.read:");
  expect(provider.content[0].text).toContain("[plan line 2, column");
  const javascript = await executePlan(cwd, "async () => {\n  return missingVariable;\n}");
  expect(javascript.isError).toBe(true);
  expect(javascript.content[0].text).toContain("ReferenceError: missingVariable is not defined");
  expect(javascript.content[0].text).toContain("[plan line 2, column");
  const syntax = await executePlan(cwd, "async () => {\n  const value =\n  return value;\n}");
  expect(syntax.isError).toBe(true);
  expect(syntax.content[0].text).toContain("[plan line 3]");
}, 20000);

test("large successful output remains recoverable without repeating a side effect", async () => {
  const cwd = await temporary();
  const result = await executePlan(cwd, `async () => {
    await system.exec({ argv: ["sh", "-c", "printf x >> counter"] });
    return "مرحبا😀".repeat(4000);
  }`);
  expect(result.isError).not.toBe(true);
  const output = result.details.codeModeOutput;
  directories.push(dirname(output.path));
  expect(output.truncated).toBe(true);
  expect(output.bytes).toBe(Buffer.byteLength("مرحبا😀".repeat(4000)));
  expect(await readFile(output.path, "utf8")).toBe("مرحبا😀".repeat(4000));
  expect((await stat(output.path)).mode & 0o777).toBe(0o600);
  expect((await stat(dirname(output.path))).mode & 0o777).toBe(0o700);
  expect(result.details.codeModeCalls).toHaveLength(1);
  expect(Buffer.byteLength(result.content[0].text)).toBeLessThan(8000);
  expect(result.content[0].text).toContain("Do not rerun");
  const recovered = await executePlan(cwd, "async () => { const text = await workspace.read({ path: " + JSON.stringify(output.path) + " }); return text.slice(0, 7); }");
  expect(recovered.content[0].text).toBe("مرحبا😀");
  expect(await readFile(join(cwd, "counter"), "utf8")).toBe("x");
}, 20000);
