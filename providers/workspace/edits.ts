import type { EditReplacement } from "../../core/types.ts";

export interface AppliedFileEdit {
	normalized: string;
	updated: string;
	finalContent: string;
}

export function parseEditReplacements(args: Record<string, unknown>): EditReplacement[] {
	let edits = args.edits;
	// Raid's prepare_arguments: accept JSON-stringified edits and the legacy
	// single oldText/newText pair.
	if (typeof edits === "string") {
		try {
			edits = JSON.parse(edits);
		} catch {
			throw new Error("Edit requires an edits array");
		}
	}
	const list = Array.isArray(edits) ? [...edits] : [];
	if (list.length === 0) {
		const oldText = args.oldText;
		const newText = args.newText;
		if (typeof oldText === "string" && typeof newText === "string") {
			list.push({ oldText, newText });
		}
	}
	if (list.length === 0) throw new Error("Edit requires at least one replacement");
	return list.map((edit, index) => {
		const record = (edit ?? {}) as Record<string, unknown>;
		const oldText = record.oldText;
		const newText = record.newText;
		if (typeof oldText !== "string") throw new Error(`edits[${index}].oldText must be a string`);
		if (typeof newText !== "string") throw new Error(`edits[${index}].newText must be a string`);
		return { oldText, newText };
	});
}

export function applyReplacements(content: string, edits: EditReplacement[], path: string): string {
	const matches: Array<{ editIndex: number; start: number; end: number; newText: string }> = [];
	for (let index = 0; index < edits.length; index++) {
		const needle = edits[index].oldText;
		if (needle === "") throw new Error(`edits[${index}].oldText must not be empty in ${path}`);
		const occurrences: number[] = [];
		for (let at = content.indexOf(needle); at !== -1; at = content.indexOf(needle, at + 1)) {
			occurrences.push(at);
		}
		if (occurrences.length === 0) {
			throw new Error(
				`Could not find edits[${index}] in ${path}. oldText must match the file including whitespace and newlines`,
			);
		}
		if (occurrences.length > 1) {
			throw new Error(
				`Found ${occurrences.length} occurrences of edits[${index}] in ${path}. Add more surrounding text so oldText is unique`,
			);
		}
		matches.push({ editIndex: index, start: occurrences[0], end: occurrences[0] + needle.length, newText: edits[index].newText });
	}
	matches.sort((a, b) => a.start - b.start);
	for (let i = 1; i < matches.length; i++) {
		if (matches[i - 1].end > matches[i].start) {
			throw new Error(
				`edits[${matches[i - 1].editIndex}] and edits[${matches[i].editIndex}] overlap in ${path}. Merge them into one replacement`,
			);
		}
	}
	let out = "";
	let cursor = 0;
	for (const match of matches) {
		out += content.slice(cursor, match.start) + match.newText;
		cursor = match.end;
	}
	out += content.slice(cursor);
	return out;
}

export function applyFileReplacements(raw: string, edits: EditReplacement[], path: string): AppliedFileEdit {
	const bom = raw.charCodeAt(0) === 0xfeff ? "\ufeff" : "";
	const content = bom ? raw.slice(1) : raw;
	const crlf = content.includes("\r\n");
	const normalized = crlf ? content.replace(/\r\n/g, "\n") : content;
	const updated = applyReplacements(normalized, edits, path);
	return {
		normalized,
		updated,
		finalContent: bom + (crlf ? updated.replace(/\n/g, "\r\n") : updated),
	};
}
