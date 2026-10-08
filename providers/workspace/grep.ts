import { readFile, stat } from "node:fs/promises";
import { matchesGlob, relative } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { MAX_GREP_LIMIT, MAX_GREP_LINE_CHARS, MAX_GREP_RESULTS, MAX_SEARCH_FILE_BYTES } from "../../core/constants.ts";
import type { MethodEnv } from "../../core/types.ts";
import { toolError, toolValue } from "../../results/tool-result.ts";
import { resolveAllowedPath } from "./confine.ts";
import { walk } from "./paths.ts";

export interface GrepMatch {
	path: string;
	line: number;
	text: string;
}

/**
 * Plans filter and count matches themselves, so grep returns structured
 * records instead of a text dump, and says explicitly when it stopped early.
 */
export async function runWorkspaceGrep(args: Record<string, unknown>, env: MethodEnv): Promise<AgentToolResult> {
	const pattern = String(args.pattern ?? "");
	if (!pattern) return toolError("grep pattern must be a non-empty string.");
	let regex: RegExp;
	try {
		regex = new RegExp(pattern, args.ignoreCase === true ? "iu" : "u");
	} catch (error) {
		return toolError(`Invalid grep pattern: ${error instanceof Error ? error.message : String(error)}`);
	}
	const fileGlob = typeof args.glob === "string" && args.glob.trim() ? args.glob.trim() : undefined;
	const limit = typeof args.limit === "number" ? Math.floor(args.limit) : MAX_GREP_RESULTS;
	if (limit < 1 || limit > MAX_GREP_LIMIT) return toolError(`grep limit must be between 1 and ${MAX_GREP_LIMIT}.`);

	const root = await resolveAllowedPath(args.path ? String(args.path) : ".", env.cwd);
	const rootStat = await stat(root);
	let files: string[];
	if (rootStat.isFile()) {
		files = [root];
	} else if (rootStat.isDirectory()) {
		files = [];
		for await (const file of walk(root)) {
			if (!fileGlob || matchesGlob(relative(root, file), fileGlob)) files.push(file);
		}
		// readdir order is filesystem-dependent; sort so a truncated result is a stable prefix.
		files.sort();
	} else {
		return toolError("grep path must be a file or directory.");
	}

	const matches: GrepMatch[] = [];
	for (const file of files) {
		const bytes = await readFile(file);
		if (bytes.length > MAX_SEARCH_FILE_BYTES || bytes.includes(0)) continue;
		const lines = bytes.toString("utf8").split("\n");
		const path = relative(env.cwd, file);
		for (let i = 0; i < lines.length; i++) {
			if (!regex.test(lines[i])) continue;
			if (matches.length >= limit) return toolValue({ matches, truncated: true });
			const text = lines[i].length > MAX_GREP_LINE_CHARS ? `${lines[i].slice(0, MAX_GREP_LINE_CHARS)}…` : lines[i];
			matches.push({ path, line: i + 1, text });
		}
	}
	return toolValue({ matches, truncated: false });
}
