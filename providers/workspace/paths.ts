import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { IGNORED_DIRS, MAX_READ_BYTES, MAX_READ_LINES } from "../../core/constants.ts";

export function resolveWorkspacePath(input: string, cwd: string): string {
	let p = input;
	if (p === "~" || p.startsWith("~/")) p = join(homedir(), p.slice(1));
	if (!isAbsolute(p)) p = resolve(cwd, p);
	return p;
}

export async function* walk(root: string): AsyncGenerator<string> {
	let entries: Dirent[];
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const full = join(root, entry.name);
		if (entry.isDirectory()) {
			if (IGNORED_DIRS.has(entry.name)) continue;
			yield* walk(full);
		} else if (entry.isFile()) {
			yield full;
		}
	}
}

export function truncateText(text: string): string {
	const lines = text.split("\n");
	if (text.length <= MAX_READ_BYTES && lines.length <= MAX_READ_LINES) return text;
	if (text.length > MAX_READ_BYTES) {
		return `${text.slice(0, MAX_READ_BYTES)}\n[truncated: ${text.length} bytes]`;
	}
	return `${lines.slice(0, MAX_READ_LINES).join("\n")}\n[truncated: ${lines.length} lines]`;
}
