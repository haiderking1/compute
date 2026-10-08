import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_READ_BYTES } from "../../core/constants.ts";
import type { MethodEnv } from "../../core/types.ts";
import { runWorkspaceRead } from "./methods.ts";

let cwd: string;
beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "pi-compute-read-test-"));
});
afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

async function read(args: Record<string, unknown>) {
	const env: MethodEnv = { cwd, signal: undefined, execGroups: new Set() };
	const result = await runWorkspaceRead(args, env);
	const [first] = result.content;
	return { isError: result.isError === true, text: first?.type === "text" ? first.text : "" };
}

test("returns a long file whole instead of cutting it at a line count", async () => {
	const content = Array.from({ length: 5_000 }, (_, i) => `line ${i + 1}`).join("\n");
	await writeFile(join(cwd, "long.txt"), content);
	expect(await read({ path: "long.txt" })).toEqual({ isError: false, text: content });
});

test("offset and limit select a range", async () => {
	await writeFile(join(cwd, "lines.txt"), "a\nb\nc\nd\n");
	expect((await read({ path: "lines.txt", offset: 2, limit: 2 })).text).toBe("b\nc");
});

test("a selection over the read limit fails with what the plan needs to narrow it", async () => {
	const line = "x".repeat(1023);
	const lineCount = Math.ceil(MAX_READ_BYTES / 1024) + 10;
	await writeFile(join(cwd, "huge.txt"), Array.from({ length: lineCount }, () => line).join("\n"));

	const whole = await read({ path: "huge.txt" });
	expect(whole.isError).toBe(true);
	expect(whole.text).toContain("over the 4 MiB read limit");
	expect(whole.text).toContain(`file has ${lineCount} lines`);
	expect(whole.text).toContain("offset/limit");

	const range = await read({ path: "huge.txt", offset: 1, limit: 100 });
	expect(range.isError).toBe(false);
	expect(range.text.split("\n")).toHaveLength(100);
});
