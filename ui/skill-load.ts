interface ProviderCall {
	provider: "workspace" | "system" | "mcp";
	method: string;
	argumentsSource: string;
}

interface ScanResult {
	calls: ProviderCall[];
	hasUnsupportedProviderReference: boolean;
}

const PROVIDERS = new Set(["workspace", "system", "mcp"]);
const SKILL_PATH = /(?:^|[\/])(?:SKILL\.md(?:$|[?#])|skills[\/])/i;
const BACKTICK = String.fromCharCode(96);

function isIdentifierStart(char: string | undefined): boolean {
	return char !== undefined && /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char: string | undefined): boolean {
	return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

function isQuote(char: string | undefined): boolean {
	return char === "\"" || char === "'" || char === BACKTICK;
}

function skipQuoted(source: string, start: number): number {
	const quote = source[start];
	for (let index = start + 1; index < source.length; index += 1) {
		if (source[index] === "\\") {
			index += 1;
			continue;
		}
		if (source[index] === quote) return index + 1;
	}
	return source.length;
}

function skipLineComment(source: string, start: number): number {
	const end = source.indexOf("\n", start + 2);
	return end === -1 ? source.length : end + 1;
}

function skipBlockComment(source: string, start: number): number {
	const end = source.indexOf("*/", start + 2);
	return end === -1 ? source.length : end + 2;
}

function skipTrivia(source: string, start: number): number {
	let index = start;
	while (index < source.length) {
		if (/\s/.test(source[index] ?? "")) {
			index += 1;
			continue;
		}
		if (source[index] === "/" && source[index + 1] === "/") {
			index = skipLineComment(source, index);
			continue;
		}
		if (source[index] === "/" && source[index + 1] === "*") {
			index = skipBlockComment(source, index);
			continue;
		}
		break;
	}
	return index;
}

function readIdentifier(source: string, start: number): { value: string; end: number } | undefined {
	if (!isIdentifierStart(source[start])) return undefined;
	let end = start + 1;
	while (isIdentifierPart(source[end])) end += 1;
	return { value: source.slice(start, end), end };
}

function readBracketMethod(source: string, start: number): { value: string; end: number } | undefined {
	let index = skipTrivia(source, start + 1);
	if (source[index] !== "\"" && source[index] !== "'") return undefined;
	const endQuote = skipQuoted(source, index);
	if (source[endQuote - 1] !== source[index]) return undefined;
	const value = source.slice(index + 1, endQuote - 1);
	index = skipTrivia(source, endQuote);
	if (source[index] !== "]") return undefined;
	return { value, end: index + 1 };
}

function findClosingParen(source: string, open: number): number | undefined {
	let depth = 0;
	for (let index = open; index < source.length; index += 1) {
		const char = source[index];
		if (isQuote(char)) {
			index = skipQuoted(source, index) - 1;
			continue;
		}
		if (char === "/" && source[index + 1] === "/") {
			index = skipLineComment(source, index) - 1;
			continue;
		}
		if (char === "/" && source[index + 1] === "*") {
			index = skipBlockComment(source, index) - 1;
			continue;
		}
		if (char === "(") depth += 1;
		if (char === ")") {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return undefined;
}

function scanProviderCalls(source: string): ScanResult {
	const calls: ProviderCall[] = [];
	let hasUnsupportedProviderReference = false;

	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		if (isQuote(char)) {
			index = skipQuoted(source, index) - 1;
			continue;
		}
		if (char === "/" && source[index + 1] === "/") {
			index = skipLineComment(source, index) - 1;
			continue;
		}
		if (char === "/" && source[index + 1] === "*") {
			index = skipBlockComment(source, index) - 1;
			continue;
		}

		const identifier = readIdentifier(source, index);
		if (!identifier) continue;
		index = identifier.end - 1;
		if (!PROVIDERS.has(identifier.value)) continue;

		let previous = index - identifier.value.length;
		while (previous >= 0 && /\s/.test(source[previous] ?? "")) previous -= 1;
		if (source[previous] === ".") {
			hasUnsupportedProviderReference = true;
			continue;
		}

		let cursor = skipTrivia(source, identifier.end);
		let method: { value: string; end: number } | undefined;
		if (source[cursor] === ".") {
			cursor = skipTrivia(source, cursor + 1);
			method = readIdentifier(source, cursor);
		} else if (source[cursor] === "[") {
			method = readBracketMethod(source, cursor);
		}

		if (!method) {
			hasUnsupportedProviderReference = true;
			continue;
		}
		cursor = skipTrivia(source, method.end);
		if (source[cursor] !== "(") {
			hasUnsupportedProviderReference = true;
			continue;
		}
		const close = findClosingParen(source, cursor);
		if (close === undefined) {
			hasUnsupportedProviderReference = true;
			continue;
		}
		calls.push({
			provider: identifier.value as ProviderCall["provider"],
			method: method.value,
			argumentsSource: source.slice(cursor + 1, close),
		});
	}

	return { calls, hasUnsupportedProviderReference };
}

function staticStrings(source: string): string[] {
	const strings: string[] = [];
	for (let index = 0; index < source.length; index += 1) {
		const quote = source[index];
		if (!isQuote(quote)) continue;
		const end = skipQuoted(source, index);
		if (source[end - 1] !== quote) break;
		const value = source.slice(index + 1, end - 1);
		if (quote !== BACKTICK || !value.includes("$" + "{")) strings.push(value);
		index = end - 1;
	}
	return strings;
}

function readsAStaticSkillPath(call: ProviderCall): boolean {
	return staticStrings(call.argumentsSource).some((value) => SKILL_PATH.test(value));
}

/**
 * Return true only for a dedicated skill-loading plan.
 *
 * Skill output is hidden by the TUI, so mixed plans must stay normal compute
 * calls. Every provider operation must be a workspace.read call whose
 * arguments contain a static skill path.
 */
export function isSkillLoad(args: { title?: unknown; code?: unknown }): boolean {
	const code = typeof args?.code === "string" ? args.code : "";
	if (!code) return false;

	const scan = scanProviderCalls(code);
	if (scan.hasUnsupportedProviderReference || scan.calls.length === 0) return false;
	return scan.calls.every(
		(call) => call.provider === "workspace" && call.method === "read" && readsAStaticSkillPath(call),
	);
}

/** Classify a completed compute result from its recorded provider calls. */
export function isSkillLoadTrace(details: unknown): boolean {
	if (!details || typeof details !== "object" || Array.isArray(details)) return false;
	const calls = (details as Record<string, unknown>).codeModeCalls;
	if (!Array.isArray(calls) || calls.length === 0) return false;
	return calls.every((call) => {
		if (!call || typeof call !== "object" || Array.isArray(call)) return false;
		const entry = call as Record<string, unknown>;
		return (
			entry.provider === "workspace" &&
			entry.method === "read" &&
			typeof entry.path === "string" &&
			SKILL_PATH.test(entry.path)
		);
	});
}
