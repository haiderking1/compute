import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_PROCESS_OUTPUT_BYTES } from "../../core/constants.ts";
import type { MethodEnv } from "../../core/types.ts";
import { runSystemBash, runSystemExec } from "./methods.ts";

let scratch: string;
beforeAll(async () => {
	scratch = await mkdtemp(join(tmpdir(), "pi-compute-process-test-"));
	await mkdir(join(scratch, "nested"));
});
afterAll(async () => {
	await rm(scratch, { recursive: true, force: true });
});

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

test("exec runs in the requested cwd", async () => {
	const result = await runSystemExec({ argv: ["pwd"], cwd: "nested" }, methodEnv(await realpath(scratch)));
	expect((result.details as { codeModeValue: { stdout: string } }).codeModeValue.stdout).toBe(
		`${join(await realpath(scratch), "nested")}\n`,
	);
});

test("a command killed by its timeout says so", async () => {
	const started = Date.now();
	const result = await runSystemExec({ argv: ["sleep", "5"], timeout: 0.2 }, methodEnv());
	expect(Date.now() - started).toBeLessThan(2_000);
	expect(result.details).toEqual({ codeModeValue: { exitCode: 137, stdout: "", stderr: "", timedOut: true } });
});

test("output past the cap is cut cleanly and flagged, not marked inline", async () => {
	const overCap = MAX_PROCESS_OUTPUT_BYTES + 1024;
	const result = await runSystemExec({ argv: ["head", "-c", String(overCap), "/dev/zero"] }, methodEnv());
	const value = (result.details as { codeModeValue: Record<string, unknown> }).codeModeValue;
	expect((value.stdout as string).length).toBe(MAX_PROCESS_OUTPUT_BYTES);
	expect(value.stdoutTruncated).toBe(true);
	expect(value.stderrTruncated).toBeUndefined();
});

test("multi-byte characters split across pipe chunks decode intact", async () => {
	// One ASCII byte shifts 300k two-byte characters off the even 64 KiB pipe
	// chunk boundaries, so some characters straddle two reads.
	const script = 'process.stdout.write("a" + "é".repeat(300000))';
	const result = await runSystemExec({ argv: [process.env.PI_COMPUTE_NODE || "node", "-e", script] }, methodEnv());
	const value = (result.details as { codeModeValue: { stdout: string; stdoutTruncated?: true } }).codeModeValue;
	expect(value.stdout.includes("\uFFFD")).toBe(false);
	expect(value.stdout).toBe(`a${"é".repeat(300_000)}`);
	expect(value.stdoutTruncated).toBeUndefined();
});

test("exec still returns the outcome of a program that starts", async () => {
	const result = await runSystemExec({ argv: ["sh", "-c", "echo hi; exit 3"] }, methodEnv());
	expect(result.isError).toBeUndefined();
	expect(result.details).toEqual({ codeModeValue: { exitCode: 3, stdout: "hi\n", stderr: "" } });
});
