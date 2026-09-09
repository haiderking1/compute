import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("split compute tool integration", () => {
	test("composes every built-in provider through the real worker", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-compute-split-"));
		temporaryDirectories.push(cwd);
		const entry = fileURLToPath(new URL("../index.ts", import.meta.url));
		const file = join(cwd, "nested", "sample.txt");
		const pattern = join(cwd, "**", "*.txt");
		const plan = String.raw`async () => {
			await workspace.write({ path: ${JSON.stringify(file)}, content: "alpha\nbeta\n" });
			await workspace.edit({ path: ${JSON.stringify(file)}, edits: [{ oldText: "beta", newText: "gamma" }] });
			const text = await workspace.read({ path: ${JSON.stringify(file)} });
			const files = await workspace.glob({ pattern: ${JSON.stringify(pattern)} });
			const matches = await workspace.grep({ pattern: "gamma", path: ${JSON.stringify(cwd)} });
			const processResult = await system.exec({ argv: ["printf", "ok"] });
			return { text, files, matches, processResult };
		}`;
		const script = `const module = await import(${JSON.stringify(entry)});
const definition = module.makeComputeToolDefinition();
const result = await definition.execute("integration", { title: "exercise providers", code: ${JSON.stringify(plan)} }, undefined, undefined, { cwd: ${JSON.stringify(cwd)}, model: { input: ["text"] } });
console.log(JSON.stringify(result));`;
		const child = Bun.spawn([process.execPath, "-e", script], {
			cwd: homedir(),
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
		const result = JSON.parse(stdout);
		if (result.isError === true) throw new Error(JSON.stringify(result));
		expect(result.isError).not.toBe(true);
		const value = JSON.parse(result.content[0].text);
		expect(value.text).toBe("alpha\ngamma\n");
		expect(value.files).toHaveLength(1);
		expect(value.files[0]).toEndWith("nested/sample.txt");
		expect(value.matches).toContain("nested/sample.txt:2:gamma");
		expect(value.processResult).toEqual({ exitCode: 0, stdout: "ok", stderr: "" });
		expect(await readFile(file, "utf8")).toBe("alpha\ngamma\n");
		expect(result.details.codeModeCalls.map(({ provider, method }: { provider: string; method: string }) => `${provider}.${method}`)).toEqual([
			"workspace.write",
			"workspace.edit",
			"workspace.read",
			"workspace.glob",
			"workspace.grep",
			"system.exec",
		]);
	}, 20_000);
});
