import { Box, Container, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { isSkillLoad, isSkillLoadTrace } from "./skill-load.ts";

export interface ComputeRenderArgs {
	title?: unknown;
	code?: unknown;
}

export interface ComputeRenderResult {
	content?: Array<{ type?: unknown; text?: unknown }>;
	details?: unknown;
	isError?: unknown;
}

export interface ComputeRenderState extends Record<string, unknown> {
	done?: boolean;
	isError?: boolean;
	isSkillLoad?: boolean;
}

interface ComputeTheme {
	fg(color: never, text: string): string;
	bg(color: never, text: string): string;
	bold(text: string): string;
	getColorMode?: () => string;
}

interface CallRenderContext {
	lastComponent?: unknown;
	state: ComputeRenderState;
}

interface ResultRenderContext extends CallRenderContext {
	args?: ComputeRenderArgs;
	isError?: boolean;
	invalidate(): void;
}

/**
 * Streaming renders may not have title yet (args arrive incrementally); fall
 * back to the first meaningful code line so the UI never shows a wall of code.
 */
export function deriveFallbackTitle(code: unknown): string {
	if (typeof code !== "string") return "…";
	const line =
		code
			.split("\n")
			.map((l) => l.trim())
			.find((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*")) ?? "";
	return line ? line.slice(0, 80) : "compute plan";
}

/**
 * Purple strip background for skill invocations — compute's own brand
 * styling, independent of the theme file. Dark gruvbox fg on gruvbox
 * purple, with a 256-color fallback when the terminal downgrades.
 */
function makeStripBg(bgTruecolor: string, bg256: string, theme?: { getColorMode?: () => string }) {
	const tc = typeof theme?.getColorMode === "function" && theme.getColorMode() === "256color";
	const bg = tc ? bg256 : bgTruecolor;
	const fg = tc ? "38;5;250" : "38;2;235;219;178";
	return (line: string) => `\x1b[${bg}m\x1b[${fg}m${line}\x1b[0m`;
}

/** Deep muted purple — the skill-identity color. */
function purpleStripBg(theme?: { getColorMode?: () => string }) {
	return makeStripBg("48;2;110;75;142", "48;5;97", theme);
}

/** Gruvbox neutral red — skill load failures. */
function redStripBg(theme?: { getColorMode?: () => string }) {
	return makeStripBg("48;2;204;36;29", "48;5;124", theme);
}

/** Background key for the normal-call strips, driven by shared state. */
function stripBgKey(state: ComputeRenderState): string {
	return state.done ? (state.isError ? "toolErrorBg" : "toolSuccessBg") : "toolPendingBg";
}

function completedSkillLoad(args: ComputeRenderArgs, details: unknown): boolean {
	// The source check rejects indirect and dynamic forms. The completed trace
	// is the authority that prevents an optimistic source match from hiding a
	// mixed plan, a parse failure, or a call to another provider.
	return isSkillLoad(args) && isSkillLoadTrace(details);
}

export function renderComputeCall(args: ComputeRenderArgs, theme: ComputeTheme, context: CallRenderContext) {
	const title =
		typeof args?.title === "string" && args.title.trim()
			? args.title.trim()
			: deriveFallbackTitle(args?.code);
	const skillLoad = context.state.done === true ? context.state.isSkillLoad === true : isSkillLoad(args);
	// Skill invocations get their own identity: full purple strips, no tool
	// chrome, so loading a skill reads as a special event.
	if (skillLoad) {
		const failed = context.state.done === true && context.state.isError === true;
		const bg = failed ? redStripBg(theme) : purpleStripBg(theme);
		const prev = context.lastComponent as
			| { setText(text: string): void; setCustomBgFn?(fn: (line: string) => string): void }
			| undefined;
		const component = prev && typeof prev.setCustomBgFn === "function" ? prev : new Text("", 1, 0, bg);
		component.setCustomBgFn?.(bg);
		component.setText(truncateToWidth(`\x1b[1m✦ skill\x1b[22m · ${title}`, 140));
		return component;
	}
	// Normal calls: own the framing (renderShell self) and mirror pi's
	// default box, with the background following shared execution state.
	const line = theme.fg("toolTitle" as never, theme.bold("compute")) + theme.fg("muted" as never, " · ") + title;
	const box = new Box(1, 0, (text: string) => theme.bg(stripBgKey(context.state) as never, text));
	box.addChild(new Text(line));
	return box;
}

export function renderComputeResult(
	result: ComputeRenderResult,
	options: { expanded?: unknown; isPartial?: unknown },
	theme: ComputeTheme,
	context: ResultRenderContext,
) {
	// Pi passes error status through context, not the result payload.
	const isError = typeof context.isError === "boolean" ? context.isError : result?.isError === true;
	const isPartial = options?.isPartial === true;
	const sourceArgs = context.args ?? {};
	const skillLoad = isPartial ? isSkillLoad(sourceArgs) : completedSkillLoad(sourceArgs, result?.details);
	// Pi invalidate() synchronously rebuilds this row. Defer it until the
	// current pass finishes, otherwise both passes append a result component.
	if (
		!isPartial &&
		(!context.state.done || context.state.isError !== isError || context.state.isSkillLoad !== skillLoad)
	) {
		context.state.done = true;
		context.state.isError = isError;
		context.state.isSkillLoad = skillLoad;
		queueMicrotask(() => context.invalidate());
	}
	// Skill loads show ZERO content — just the purple confirmation strip.
	if (skillLoad) {
		// No result line at all: success just keeps the purple strip, and a
		// failure flips that same strip red via shared state. Nothing else.
		return new Container();
	}
	// Normal calls: replicate pi's default result fallback (preview,
	// expand hint) inside our own stateful box.
	const parts = (Array.isArray(result?.content) ? result.content : [])
		.filter((part) => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text as string);
	const output = parts.join("\n");
	const lines = output.length > 0 ? output.split("\n") : [];
	const displayLines = options?.expanded === true ? lines : lines.slice(0, 10);
	const remaining = lines.length - displayLines.length;
	let text = displayLines.map((line) => theme.fg("toolOutput" as never, line)).join("\n");
	if (remaining > 0) {
		text += theme.fg("muted" as never, `\n... (${remaining} more lines, ctrl+o to expand)`);
	}
	if (lines.length === 0) text = theme.fg("muted" as never, "(no output)");
	const bgKey = isError ? "toolErrorBg" : isPartial ? "toolPendingBg" : "toolSuccessBg";
	const box = new Box(1, 0, (t: string) => theme.bg(bgKey as never, t));
	box.addChild(new Text(text));
	return box;
}
