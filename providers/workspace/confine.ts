import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { resolveWorkspacePath } from "./paths.ts";

/**
 * Under Claude Code, workspace methods stay inside the project and Claude's per-user temp root
 * (where oversized results are saved), unless COMPUTE_ALLOW_OUTSIDE=1. Pi keeps unrestricted paths.
 */
export function workspaceConfined(): boolean {
	return process.env.CLAUDECODE === "1" && process.env.COMPUTE_ALLOW_OUTSIDE !== "1";
}

export function claudeTempRoot(): string {
	return join(tmpdir(), `claude-${process.getuid?.() ?? "user"}`);
}

/** Real path of `path`, or of its nearest existing ancestor joined with the missing tail. */
async function realpathAllowingMissing(path: string): Promise<string> {
	const tail: string[] = [];
	let current = path;
	for (;;) {
		try {
			return join(await realpath(current), ...tail.reverse());
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const parent = dirname(current);
			if (parent === current) return path;
			tail.push(basename(current));
			current = parent;
		}
	}
}

function within(path: string, root: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/** Resolves a workspace path and, when confined, rejects real paths outside the allowed roots. */
export async function resolveAllowedPath(input: string, cwd: string): Promise<string> {
	const abs = resolveWorkspacePath(input, cwd);
	if (!workspaceConfined()) return abs;
	const real = await realpathAllowingMissing(abs);
	const roots = await Promise.all([cwd, claudeTempRoot()].map(realpathAllowingMissing));
	if (roots.some((root) => within(real, root))) return abs;
	throw new Error(
		`${input} is outside the project (${cwd}). Under Claude Code, workspace methods are limited to the project ` +
			"and Claude's temp directory; set COMPUTE_ALLOW_OUTSIDE=1 on the compute server to lift this.",
	);
}

/**
 * A confined glob is checked through its literal directory prefix, the part before the first
 * wildcard segment; `..` after a wildcard could climb anywhere, so it is rejected outright.
 */
export async function assertGlobAllowed(pattern: string, cwd: string): Promise<void> {
	if (!workspaceConfined()) return;
	const segments = pattern.split("/");
	const firstWild = segments.findIndex((segment) => /[*?[\]{}!]/.test(segment));
	if (firstWild !== -1 && segments.slice(firstWild).includes("..")) {
		throw new Error(`glob pattern ${pattern} uses .. after a wildcard, which could leave the project.`);
	}
	const prefix = segments.slice(0, firstWild === -1 ? segments.length : firstWild).join("/");
	await resolveAllowedPath(prefix || (isAbsolute(pattern) ? "/" : "."), cwd);
}
