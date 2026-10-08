export const MAX_CODE_BYTES = 100_000;
export const MAX_TIMEOUT_SECONDS = 2_147_483;
export const INLINE_OUTPUT_MAX_BYTES = 8_000;
export const MAX_OUTPUT_LINES = 2_000;
export const PREVIEW_CHARS = 2_000;

/** workspace.read fails past this (after offset/limit) rather than returning a cut file. */
export const MAX_READ_BYTES = 4 * 1024 * 1024;
export const MAX_GLOB_RESULTS = 10_000;
/** Default grep match limit; plans may raise it up to MAX_GREP_LIMIT. */
export const MAX_GREP_RESULTS = 10_000;
export const MAX_GREP_LIMIT = 50_000;
export const MAX_GREP_LINE_CHARS = 500;
export const MAX_SEARCH_FILE_BYTES = 10 * 1024 * 1024;
/** mcp.* calls fail past this rather than returning cut output. */
export const MAX_MCP_OUTPUT_BYTES = 4 * 1024 * 1024;
/** Per-stream system.exec/bash output cap; hitting it sets stdoutTruncated/stderrTruncated. */
export const MAX_PROCESS_OUTPUT_BYTES = 4 * 1024 * 1024;
export const PIPE_DRAIN_GRACE_MS = 100;
export const MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
export const NOT_SERIALIZABLE = "__COMPUTE_NOT_SERIALIZABLE__";

export const IGNORED_DIRS = new Set([
	".git",
	"node_modules",
	"target",
	".cache",
	".bun",
	".rustup",
	".cargo",
	".npm",
	"dist",
	"build",
	".next",
	".venv",
	"__pycache__",
	".oxc",
]);
