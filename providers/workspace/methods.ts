import { readFile, writeFile, mkdir, stat, glob } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { generateUnifiedPatch, detectSupportedImageMimeTypeFromFile } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { MAX_GLOB_RESULTS, MAX_GREP_BYTES, MAX_GREP_RESULTS, MAX_SEARCH_FILE_BYTES } from "../../core/constants.ts";
import type { EditReplacement, MethodEnv } from "../../core/types.ts";
import { toolError, toolText, toolValue } from "../../results/tool-result.ts";
import { applyFileReplacements, parseEditReplacements } from "./edits.ts";
import { fallbackImageAttachment, loadProcessImage } from "./images.ts";
import { assertGlobAllowed, resolveAllowedPath } from "./confine.ts";
import { truncateText, walk } from "./paths.ts";

export { applyReplacements, parseEditReplacements } from "./edits.ts";

export async function runWorkspaceRead(args: Record<string, unknown>, env: MethodEnv): Promise<AgentToolResult> {
	const path = String(args.path ?? "");
	if (!path.trim()) return toolError("Read requires a non-empty path");
	const abs = await resolveAllowedPath(path, env.cwd);
	const bytes = await readFile(abs);

	// Image escape hatch (pi read parity): image files become native image
	// blocks instead of failing the UTF-8/NUL check. The worker wraps results
	// carrying image content into the __computeToolResult envelope, which the
	// plan returns unchanged so decodeNestedResult can attach the image to
	// the model-facing tool result. offset/limit apply to text only, like
	// pi's own read tool.
	let imageMimeType: string | null = null;
	try {
		imageMimeType = await detectSupportedImageMimeTypeFromFile(abs);
	} catch {
		imageMimeType = null;
	}
	if (imageMimeType) {
		const nonVisionNote =
			env.model && !(env.model.input ?? []).includes("image")
				? "\n[Current model does not support images. The image will be omitted from this request.]"
				: "";
		try {
			const processImage = await loadProcessImage();
			const processed = processImage
				? await processImage(bytes, imageMimeType, { autoResizeImages: true })
				: fallbackImageAttachment(bytes, imageMimeType);
			if (!processed.ok) {
				return {
					content: [{ type: "text", text: `Read image file [${imageMimeType}]\n${processed.message ?? "[Image omitted.]"}${nonVisionNote}` }],
					details: null,
				};
			}
			const hints = processed.hints && processed.hints.length > 0 ? `\n${processed.hints.join("\n")}` : "";
			return {
				content: [
					{ type: "text", text: `Read image file [${processed.mimeType}]${hints}${nonVisionNote}` },
					{ type: "image", data: processed.data as string, mimeType: processed.mimeType as string },
				],
				details: null,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return toolError(`Could not process image ${path}: ${message}`);
		}
	}

	if (bytes.includes(0)) return toolError(`Could not read ${path}: file is not UTF-8 or contains NUL bytes`);

	let text = bytes.toString("utf8");
	const offset = typeof args.offset === "number" ? Math.max(1, Math.floor(args.offset)) : undefined;
	const limit = typeof args.limit === "number" ? Math.max(0, Math.floor(args.limit)) : undefined;
	if (offset !== undefined || limit !== undefined) {
		const lines = text.split("\n");
		const start = (offset ?? 1) - 1;
		text = lines.slice(start, limit !== undefined ? start + limit : undefined).join("\n");
	}
	return toolText(truncateText(text));
}

export async function runWorkspaceWrite(args: Record<string, unknown>, env: MethodEnv): Promise<AgentToolResult> {
	const path = String(args.path ?? "");
	if (!path.trim()) return toolError("Write requires a non-empty path");
	const content = String(args.content ?? "");
	const abs = await resolveAllowedPath(path, env.cwd);
	await mkdir(dirname(abs), { recursive: true });
	await writeFile(abs, content, "utf8");
	return toolText(`Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${path}`);
}

export async function runWorkspaceEdit(args: Record<string, unknown>, env: MethodEnv): Promise<AgentToolResult> {
	const path = String(args.path ?? "");
	if (!path.trim()) return toolError("Edit requires a non-empty path");
	let edits: EditReplacement[];
	try {
		edits = parseEditReplacements(args);
	} catch (error) {
		return toolError(error instanceof Error ? error.message : String(error));
	}
	const abs = await resolveAllowedPath(path, env.cwd);

	const raw = await readFile(abs, "utf8");
	let normalized: string;
	let updated: string;
	let finalContent: string;
	try {
		({ normalized, updated, finalContent } = applyFileReplacements(raw, edits, path));
	} catch (error) {
		return toolError(error instanceof Error ? error.message : String(error));
	}

	await mkdir(dirname(abs), { recursive: true });
	await writeFile(abs, finalContent, "utf8");

	const patch = generateUnifiedPatch(path, normalized, updated, 4);
	let added = 0;
	let deleted = 0;
	for (const line of patch.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) added++;
		else if (line.startsWith("-")) deleted++;
	}
	return toolText(`Edited ${edits.length} block(s), +${added} -${deleted} lines in ${path}`, {
		replacements: edits.length,
		linesAdded: added,
		linesDeleted: deleted,
		patch,
	});
}

export async function runWorkspaceGlob(args: Record<string, unknown>, env: MethodEnv): Promise<AgentToolResult> {
	const pattern = String(args.pattern ?? "").trim();
	if (!pattern) return toolError("glob pattern must be a non-empty string.");
	await assertGlobAllowed(pattern, env.cwd);
	const results: string[] = [];
	try {
		for await (const match of glob(pattern, { cwd: env.cwd, onlyFiles: true }) as AsyncIterable<string>) {
			if (results.length >= MAX_GLOB_RESULTS) break;
			results.push(match);
		}
	} catch (error) {
		return toolError(`Invalid glob pattern: ${error instanceof Error ? error.message : String(error)}`);
	}
	results.sort();
	return toolValue(results);
}

export async function runWorkspaceGrep(args: Record<string, unknown>, env: MethodEnv): Promise<AgentToolResult> {
	const pattern = String(args.pattern ?? "");
	if (!pattern) return toolError("grep pattern must be a non-empty string.");
	let regex: RegExp;
	try {
		regex = new RegExp(pattern, "u");
	} catch (error) {
		return toolError(`Invalid grep pattern: ${error instanceof Error ? error.message : String(error)}`);
	}
	const root = await resolveAllowedPath(args.path ? String(args.path) : ".", env.cwd);
	const statResult = await stat(root);
	let files: string[];
	if (statResult.isFile()) {
		files = [root];
	} else if (statResult.isDirectory()) {
		files = [];
		for await (const f of walk(root)) files.push(f);
	} else {
		return toolError("grep path must be a file or directory.");
	}
	const output: string[] = [];
	let matchCount = 0;
	let truncated = false;
	let totalBytes = 0;
	for (const file of files) {
		const bytes = await readFile(file);
		if (bytes.length > MAX_SEARCH_FILE_BYTES || bytes.includes(0)) continue;
		const content = bytes.toString("utf8");
		const lines = content.split("\n");
		const rel = relative(env.cwd, file);
		for (let i = 0; i < lines.length; i++) {
			if (!regex.test(lines[i])) continue;
			const entry = `${rel}:${i + 1}:${lines[i]}\n`;
			if (totalBytes + entry.length > MAX_GREP_BYTES || matchCount >= MAX_GREP_RESULTS) {
				truncated = true;
				break;
			}
			output.push(entry);
			totalBytes += entry.length;
			matchCount++;
		}
		if (truncated) break;
	}
	if (truncated) output.push("[truncated]\n");
	return toolText(output.join("") || "(no matches)");
}
