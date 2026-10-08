import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertGlobAllowed, claudeTempRoot, resolveAllowedPath } from "./confine.ts";

const saved = { claude: process.env.CLAUDECODE, confine: process.env.COMPUTE_CONFINE };
let base: string;
let project: string;
beforeEach(async () => {
	process.env.CLAUDECODE = "1";
	process.env.COMPUTE_CONFINE = "1";
	base = await mkdtemp(join(tmpdir(), "pi-compute-confine-test-"));
	project = join(base, "project");
	await mkdir(project);
});
afterEach(async () => {
	for (const [key, value] of [["CLAUDECODE", saved.claude], ["COMPUTE_CONFINE", saved.confine]] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	await rm(base, { recursive: true, force: true });
});

test("confined paths stay inside the project and Claude's temp root, including files not yet created", async () => {
	expect(await resolveAllowedPath("src/new/file.ts", project)).toBe(join(project, "src/new/file.ts"));
	expect(await resolveAllowedPath(join(claudeTempRoot(), "compute-output-x/result.txt"), project)).toContain("compute-output-x");
	for (const outside of ["/etc/hostname", "../sibling.txt", "~/.ssh/id_ed25519", base]) {
		await expect(resolveAllowedPath(outside, project)).rejects.toThrow("outside the project");
	}
});

test("a symlink inside the project cannot reach outside it", async () => {
	await symlink("/etc", join(project, "escape"));
	await expect(resolveAllowedPath("escape/hostname", project)).rejects.toThrow("outside the project");
});

test("without COMPUTE_CONFINE=1 paths are unrestricted, under Claude Code and Pi alike", async () => {
	delete process.env.COMPUTE_CONFINE;
	for (const claude of ["1", undefined]) {
		if (claude === undefined) delete process.env.CLAUDECODE;
		else process.env.CLAUDECODE = claude;
		expect(await resolveAllowedPath("/etc/hostname", project)).toBe("/etc/hostname");
		expect(await resolveAllowedPath("../sibling.txt", project)).toBe(join(base, "sibling.txt"));
		await expect(assertGlobAllowed("/etc/*", project)).resolves.toBeUndefined();
	}
});

test("confined globs are checked through their literal prefix", async () => {
	for (const pattern of ["src/**/*.ts", join(project, "**/*.txt"), "*.md"]) {
		await expect(assertGlobAllowed(pattern, project)).resolves.toBeUndefined();
	}
	for (const pattern of ["/etc/*", "../*", "src/../../*", "src/*/../../../*"]) {
		await expect(assertGlobAllowed(pattern, project)).rejects.toThrow(/outside the project|after a wildcard/);
	}
});
