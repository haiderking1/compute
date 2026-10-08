import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MethodEnv } from "../../core/types.ts";
import { runWorkspaceGrep } from "./grep.ts";

let cwd: string;
beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "pi-compute-grep-test-"));
	await mkdir(join(cwd, "src/deep"), { recursive: true });
	await writeFile(join(cwd, "src/b.ts"), "const TODO = 1;\nfine\ntodo: lower\n");
	await writeFile(join(cwd, "src/deep/a.ts"), "// TODO first\n");
	await writeFile(join(cwd, "notes.md"), "TODO in markdown\n");
});
afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

async function grep(args: Record<string, unknown>) {
	const env: MethodEnv = { cwd, signal: undefined, execGroups: new Set() };
	const result = await runWorkspaceGrep(args, env);
	if (result.isError) throw new Error(JSON.stringify(result.content));
	return (result.details as { codeModeValue: unknown }).codeModeValue as {
		matches: Array<{ path: string; line: number; text: string }>;
		truncated: boolean;
	};
}

test("returns structured matches sorted by path", async () => {
	expect(await grep({ pattern: "TODO" })).toEqual({
		matches: [
			{ path: "notes.md", line: 1, text: "TODO in markdown" },
			{ path: "src/b.ts", line: 1, text: "const TODO = 1;" },
			{ path: "src/deep/a.ts", line: 1, text: "// TODO first" },
		],
		truncated: false,
	});
});

test("glob narrows the files searched, relative to path", async () => {
	const { matches } = await grep({ pattern: "TODO", path: "src", glob: "**/*.ts" });
	expect(matches.map((match) => match.path)).toEqual(["src/b.ts", "src/deep/a.ts"]);
	expect((await grep({ pattern: "TODO", glob: "*.md" })).matches).toHaveLength(1);
});

test("ignoreCase widens the match", async () => {
	expect((await grep({ pattern: "todo", path: "src/b.ts" })).matches).toHaveLength(1);
	expect((await grep({ pattern: "todo", path: "src/b.ts", ignoreCase: true })).matches).toHaveLength(2);
});

test("limit cuts the results and reports truncated", async () => {
	expect(await grep({ pattern: "TODO", limit: 2 })).toEqual({
		matches: [
			{ path: "notes.md", line: 1, text: "TODO in markdown" },
			{ path: "src/b.ts", line: 1, text: "const TODO = 1;" },
		],
		truncated: true,
	});
	expect((await grep({ pattern: "TODO", limit: 3 })).truncated).toBe(false);
});

test("very long lines are clipped", async () => {
	await writeFile(join(cwd, "long.txt"), `${"x".repeat(2_000)}NEEDLE\n`);
	const [match] = (await grep({ pattern: "x", path: "long.txt" })).matches;
	expect(match.text).toHaveLength(501);
	expect(match.text.endsWith("…")).toBe(true);
});
