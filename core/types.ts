import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

export interface JsonSchemaObject {
	type?: string | string[];
	enum?: unknown[];
	oneOf?: JsonSchemaObject[];
	anyOf?: JsonSchemaObject[];
	properties?: Record<string, JsonSchemaObject>;
	items?: JsonSchemaObject;
	required?: string[];
	additionalProperties?: boolean;
	description?: string;
	minItems?: number;
	maxItems?: number;
}

export interface McpToolInfo {
	name: string;
	title?: string;
	description?: string;
	inputSchema?: JsonSchemaObject;
}

export interface McpContentPart {
	type: string;
	text?: string;
	data?: string;
	mimeType?: string;
}

export interface MethodEnv {
	cwd: string;
	signal: AbortSignal | undefined;
	/** Process-group leaders of in-flight subprocesses, drained on cancel/timeout. */
	execGroups: Set<number>;
	/** Active model (input modalities), for image-attachment capability notes. */
	model?: { input?: string[] } | undefined;
}

export interface ProcessedImageResult {
	ok: boolean;
	data?: string;
	mimeType?: string;
	hints?: string[];
	message?: string;
}

export type ProcessImageFn = (
	bytes: Buffer,
	mimeType: string,
	options?: { autoResizeImages?: boolean },
) => Promise<ProcessedImageResult>;

export interface EditReplacement {
	oldText: string;
	newText: string;
}

export interface ProcessOutcome {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export interface MethodSpec {
	name: string;
	description: string;
	/** TypeBox schema used for declarations and runtime validation. */
	schema: unknown;
	/** TypeScript return type emitted in the declarations. */
	returns: string;
	/** Optional argument normalizer run before validation (Raid's prepare_arguments). */
	prepare?: (args: Record<string, unknown>) => Record<string, unknown>;
	run: (args: Record<string, unknown>, env: MethodEnv) => Promise<AgentToolResult>;
}

export interface ProviderSpec {
	name: string;
	methods: MethodSpec[];
}
