import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { executePlan } from "./testing/execute.ts";

test("worker exposes system.bash and mcp without a raid alias", async () => {
  const result = await executePlan(tmpdir(), String.raw`async () => {
    const shell = await system.bash({ command: "printf '%s' \"$COMPUTE_NAMESPACE_TEST\" | cat", env: { COMPUTE_NAMESPACE_TEST: "shell-ok" } });
    return { shell, legacy: typeof raid, discovered: typeof mcp, direct: typeof system.exec };
  }`);
  expect(result.isError).not.toBe(true);
  const text = result.content[0].text;
  expect(text).toContain("shell-ok");
  expect(text).toContain('"legacy": "undefined"');
  expect(text).toContain('"discovered": "object"');
  expect(text).toContain('"direct": "function"');
  expect(result.details.codeModeCalls[0].provider).toBe("system");
  expect(result.details.codeModeCalls[0].method).toBe("bash");
}, 20000);

test("obsolete global references fail rather than reaching a compatibility alias", async () => {
  const result = await executePlan(tmpdir(), 'async () => raid.bash({ command: "true" })');
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("raid is not defined");
}, 20000);
