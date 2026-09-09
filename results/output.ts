import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { INLINE_OUTPUT_MAX_BYTES, MAX_OUTPUT_LINES, PREVIEW_CHARS } from "../core/constants.ts";
import { saveOutput } from "./artifacts.ts";
import { decodeNestedResult, hoistImageEnvelopes, mergeTraceDetails } from "./nested.ts";
import { toolError } from "./tool-result.ts";

type Image = { type: "image"; data: string; mimeType: string };

function preview(text: string): string {
  let result = "", chars = 0, bytes = 0, lines = 1;
  for (const char of text) {
    const size = Buffer.byteLength(char, "utf8");
    if (chars >= PREVIEW_CHARS || bytes + size > INLINE_OUTPUT_MAX_BYTES / 2 || (char === "\n" && lines >= 30)) break;
    result += char;
    chars++;
    bytes += size;
    if (char === "\n") lines++;
  }
  return result;
}

export async function formatOutput(output: string, trace: unknown): Promise<AgentToolResult> {
  const nested = decodeNestedResult(output);
  if (nested) {
    const text = nested.content.filter(part => part.type === "text").map(part => part.text).join("\n");
    const details = mergeTraceDetails(nested.details, trace);
    const images = nested.content.filter((part): part is Image => part.type === "image");
    if (Buffer.byteLength(text, "utf8") <= INLINE_OUTPUT_MAX_BYTES && lineCount(text) <= MAX_OUTPUT_LINES)
      return { content: nested.content, details, isError: nested.isError };
    return formatText(text, images, details, nested.isError);
  }

  let text = output;
  const images: Image[] = [];
  if (output.includes("__raidToolResult")) {
    try {
      const parsed: unknown = JSON.parse(output);
      if (parsed && typeof parsed === "object") {
        const transformed = hoistImageEnvelopes(parsed, images, 0);
        if (images.length) text = JSON.stringify(transformed, null, 2);
      }
    } catch { /* Plain text needs no envelope decoding. */ }
  }

  return formatText(text, images, trace);
}

function lineCount(text: string): number {
  let lines = text === "" ? 0 : 1;
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lines++;
  return lines;
}

async function formatText(text: string, images: Image[], trace: unknown, isError?: boolean): Promise<AgentToolResult> {
  const bytes = Buffer.byteLength(text, "utf8");
  const lines = lineCount(text);
  let details = trace;
  if (bytes > INLINE_OUTPUT_MAX_BYTES || lines > MAX_OUTPUT_LINES) {
    let path: string;
    try {
      path = await saveOutput(text);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = toolError(
        "Plan completed, but saving its oversized result failed: " + reason +
        "\nSide effects may already have occurred. Do not rerun the plan blindly.\nPreview:\n" + preview(text), trace);
      result.content.push(...images);
      return result;
    }
    details = mergeTraceDetails({ codeModeOutput: { truncated: true, path, bytes, lines } }, trace);
    text = "Plan completed. Full result saved to " + path + " (" + bytes + " bytes, " + lines + " lines)." +
      "\nOnly a preview follows. Read the saved file with workspace.read using offset/limit, or filter it in another plan. " +
      "Do not rerun the original plan just to recover its output.\nPreview:\n" + preview(text) + "\n[preview truncated]";
  }
  return { content: [{ type: "text", text }, ...images], details, ...(isError === undefined ? {} : { isError }) };
}
