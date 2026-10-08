import { INLINE_OUTPUT_MAX_BYTES, MAX_OUTPUT_LINES, MEMORY_LIMIT_BYTES } from "../core/constants.ts";
import { getProviders } from "../providers/catalog.ts";
import { workspaceConfined } from "../providers/workspace/confine.ts";
import { buildDeclarations } from "../schema/declarations.ts";

/** Claude Code truncates MCP tool descriptions past this many characters. */
export const HOST_DESCRIPTION_MAX_CHARS = 2_048;

/**
 * Description for MCP hosts such as Claude Code. Unlike Pi, compute sits beside the host's own
 * tools there, and the long declarations would be truncated, so they move to the code parameter.
 */
export function buildHostDescription(): string {
	const paths = workspaceConfined()
		? "workspace paths are limited to the project and Claude's temp directory"
		: "relative workspace paths start at the project; absolute and ~ paths reach other files";
	return `Run one isolated JavaScript plan that composes the workspace, system, and mcp providers and returns only the final value you need. Use it for multi-step file, search, or process work whose intermediate data should stay out of context; a single read or edit is better done with your regular tools. Provider methods (workspace.read, system.exec, mcp.web_search_exa, …) are globals inside plans, not separate tools. Their typed declarations are in the code parameter's description; they are authoritative and arguments are validated against them.

Pass an async arrow function, e.g. \`async () => (await workspace.glob({ pattern: "src/**/*.ts" })).slice(0, 20)\`. Always set title to a one-line summary; the user sees it instead of the code.
- Promise.all fails the plan on any rejection; use Promise.allSettled for independent calls. Rejections serialize as { name, provider, method, message }.
- A nonzero system.exec exitCode is returned, not thrown; check it. system.exec takes an exact argv with no shell; system.bash runs a shell string.
- Results over ${INLINE_OUTPUT_MAX_BYTES.toLocaleString("en-US")} bytes or ${MAX_OUTPUT_LINES.toLocaleString("en-US")} lines are saved to a temp file with a preview; read or filter that file instead of rerunning the plan.
- No Node.js, process, require, dynamic import, or fetch. Each call is a fresh worker with ${Math.round(MEMORY_LIMIT_BYTES / (1024 * 1024))} MiB of memory and no default timeout.
- ${paths[0].toUpperCase()}${paths.slice(1)}. system.exec and system.bash are not covered by the host's shell permission rules or sandbox, so never use them to run what your shell tool would need approval for.
- Project policy: split work into focused files in nested directories, never god files; do the proper implementation, never one that merely passes.`;
}

export function buildCodeParameterDescription(): string {
	return `An async JavaScript arrow function that calls the declared providers and returns the smallest useful result.

Provider declarations:
${buildDeclarations(getProviders())}`;
}
