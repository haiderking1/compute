import { Type } from "typebox";
import type { MethodSpec, ProviderSpec } from "../core/types.ts";
import { runSystemBash, runSystemExec } from "./process/methods.ts";
import { runWorkspaceEdit, runWorkspaceGlob, runWorkspaceGrep, runWorkspaceRead, runWorkspaceWrite } from "./workspace/methods.ts";

const EXEC_RETURN = "{ exitCode: number; stdout: string; stderr: string }";

function builtinProviders(): ProviderSpec[] {
	return [
		{
			name: "workspace",
			methods: [
				{
					name: "read",
					description:
						"Read the contents of a file (relative or absolute). Returns file text, optionally sliced by 1-indexed line offset and line limit. Image files (jpg, png, gif, webp, bmp) return an envelope that carries the image as an attachment plus a text note — return that envelope value unchanged from the plan to attach the image to your reply.",
					schema: Type.Object(
						{
							path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
							offset: Type.Optional(
								Type.Number({ description: "Line number to start reading from (1-indexed)" }),
							),
							limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
						},
						{ additionalProperties: false },
					),
					returns: "ComputeToolOutput",
					run: runWorkspaceRead,
				},
				{
					name: "write",
					description: "Create or fully replace a file with the given content (relative or absolute).",
					schema: Type.Object(
						{
							path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
							content: Type.String({ description: "Content to write to the file" }),
						},
						{ additionalProperties: false },
					),
					returns: "ComputeToolOutput",
					run: runWorkspaceWrite,
				},
				{
					name: "edit",
					description:
						"Precisely edit an existing file with one or more disjoint replacements. Each oldText is matched against the ORIGINAL file content, must occur exactly once, and replacements must not overlap.",
					schema: Type.Object(
						{
							path: Type.String({
								description: "Path to the existing file to edit, relative or absolute",
							}),
							edits: Type.Array(
								Type.Object(
									{
										oldText: Type.String({
											description:
												"Exact text to replace. Keep it small but unique, including whitespace and newlines",
										}),
										newText: Type.String({ description: "Replacement text" }),
									},
									{ additionalProperties: false },
								),
								{
									minItems: 1,
									maxItems: 50,
									description:
										"Disjoint replacements matched against the original file, not against results from earlier replacements in this call",
								},
							),
						},
						{ additionalProperties: false },
					),
					returns: "ComputeToolOutput",
					prepare: (args) => {
						// Raid's prepare_arguments: accept JSON-stringified edits and the
						// legacy single oldText/newText pair.
						let edits = args.edits;
						if (typeof edits === "string") {
							try {
								edits = JSON.parse(edits);
							} catch {
								/* validation reports the bad shape */
							}
						}
						if (Array.isArray(edits) && edits.length > 0) return { ...args, edits };
						if (typeof args.oldText === "string" && typeof args.newText === "string") {
							return { path: args.path, edits: [{ oldText: args.oldText, newText: args.newText }] };
						}
						return args;
					},
					run: runWorkspaceEdit,
				},
				{
					name: "glob",
					description: "Find files by path glob. A single * matches one path component and ** is recursive.",
					schema: Type.Object(
						{ pattern: Type.String({ description: "Path glob such as src/**/*.rs" }) },
						{ additionalProperties: false },
					),
					returns: "string[]",
					run: runWorkspaceGlob,
				},
				{
					name: "grep",
					description:
						"Search UTF-8 files with a regular expression. Returns path, line number, and matching text.",
					schema: Type.Object(
						{
							pattern: Type.String({ description: "Regular expression" }),
							path: Type.Optional(Type.String({ description: "Optional file or directory path" })),
						},
						{ additionalProperties: false },
					),
					returns: "string",
					run: runWorkspaceGrep,
				},
			],
		},
		{
			name: "system",
			methods: [
				{
					name: "exec",
					description:
						"Run one program directly with an exact argument array. No shell parsing, pipes, redirection, expansion, or implicit stdin. Never probe sudo availability or passwordless access, and never ask for or handle a password. Graphical applications cannot run as root.",
					schema: Type.Object(
						{
							argv: Type.Array(Type.String(), {
								minItems: 1,
								description: 'Executable followed by exact arguments, for example ["git", "status"]',
							}),
							timeout: Type.Optional(
								Type.Number({ description: "Optional hard deadline in seconds for this command" }),
							),
						},
						{ additionalProperties: false },
					),
					returns: EXEC_RETURN,
					run: runSystemExec,
				},
				{
					name: "bash",
					description:
						"Run a command through the shell (bash -lc). Unlike system.exec this parses the command string, so pipes, redirection, and expansion work. Prefer system.exec when an exact argv is enough.",
					schema: Type.Object(
						{
							command: Type.String({ description: "The bash command line to run" }),
							cwd: Type.Optional(Type.String({ description: "Optional working directory" })),
							env: Type.Optional(
								Type.Record(Type.String(), Type.String(), {
									description: "Optional extra environment variables",
								}),
							),
							timeout: Type.Optional(
								Type.Number({ description: "Optional hard deadline in seconds for this command" }),
							),
						},
						{ additionalProperties: false },
					),
					returns: EXEC_RETURN,
					run: runSystemBash,
				},
			],
		},
		{ name: "mcp", methods: [] },
	];
}

// Live catalog: builtin providers, extended with MCP web tools at session start.
let providers: ProviderSpec[] = builtinProviders();

export function findMethod(providerName: string, methodName: string): { provider: ProviderSpec; method: MethodSpec } | undefined {
	const provider = providers.find((p) => p.name === providerName);
	if (!provider) return undefined;
	const method = provider.methods.find((m) => m.name === methodName);
	if (!method) return undefined;
	return { provider, method };
}

export function getProviders(): ProviderSpec[] {
	return providers;
}

export function refreshProviders(): void {
	providers = [...providers];
}
