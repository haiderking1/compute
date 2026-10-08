import { readFile, writeFile, mkdir, glob } from "node:fs/promises";
import { dirname } from "node:path";
import { generateUnifiedPatch, detectSupportedImageMimeTypeFromFile } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { MAX_GLOB_RESULTS, MAX_READ_BYTES } from "../../core/constants.ts";
import { formatMiB } from "../../core/format.ts";
import type { EditReplacement, MethodEnv } from "../../core/types.ts";
import { toolError, toolText, toolValue } from "../../results/tool-result.ts";
import { applyFileReplacements, parseEditReplacements } from "./edits.ts";
import { fallbackImageAttachment, loadProcessImage } from "./images.ts";
import { assertGlobAllowed, resolveAllowedPath } from "./confine.ts";

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
	// A plan can't tell a cut file from a whole one, so fail with what it needs
	// to ask for a smaller range instead.
	const selectedBytes = Buffer.byteLength(text, "utf8");
	if (selectedBytes > MAX_READ_BYTES) {
		const lineCount = bytes.toString("utf8").split("\n").length;
		return toolError(
			`${path}: selected text is ${formatMiB(selectedBytes)} MiB, over the ${formatMiB(MAX_READ_BYTES)} MiB read limit (file has ${lineCount} lines). Read a range with offset/limit, or search it with workspace.grep.`,
		);
	}
	return toolText(text);
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
			// Fail loudly: glob order is unsorted, so a cut list would be an arbitrary subset.
			if (results.length >= MAX_GLOB_RESULTS) {
				return toolError(`glob matched more than ${MAX_GLOB_RESULTS} files; narrow the pattern.`);
			}
			results.push(match);
		}
	} catch (error) {
		return toolError(`Invalid glob pattern: ${error instanceof Error ? error.message : String(error)}`);
	}
	results.sort();
	return toolValue(results);
}

export { runWorkspaceGrep } from "./grep.ts";
