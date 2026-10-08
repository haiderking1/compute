import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MethodEnv } from "../../core/types.ts";
import { runSystemBash, runSystemExec } from "./methods.ts";

function methodEnv(cwd = tmpdir()): MethodEnv {
	return { cwd, signal: undefined, execGroups: new Set() };
}

function errorText(result: Awaited<ReturnType<typeof runSystemExec>>): string {
	const [first] = result.content;
	return first?.type === "text" ? first.text : "";
}

test("exec returns a tool error for a missing binary instead of crashing the server", async () => {
	const result = await runSystemExec({ argv: ["compute-test-missing-binary"] }, methodEnv());
	expect(result.isError).toBe(true);
	expect(errorText(result)).toContain("compute-test-missing-binary");
});

test("bash returns a tool error when the working directory does not exist", async () => {
	const missing = join(tmpdir(), "compute-test-missing-dir", "nested");
	const result = await runSystemBash({ command: "true", cwd: missing }, methodEnv());
	expect(result.isError).toBe(true);
	expect(errorText(result)).toBe(`working directory does not exist: ${missing}`);
});

test("exec still returns the outcome of a program that starts", async () => {
	const result = await runSystemExec({ argv: ["sh", "-c", "echo hi; exit 3"] }, methodEnv());
	expect(result.isError).toBeUndefined();
	expect(result.details).toEqual({ codeModeValue: { exitCode: 3, stdout: "hi\n", stderr: "" } });
});
