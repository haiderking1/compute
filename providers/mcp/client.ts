import type { McpContentPart, McpToolInfo } from "../../core/types.ts";
import { type McpConfig, resolveMcpConfig } from "./config.ts";
import { displayMcpUrl, redactMcpError } from "./redact.ts";

const MCP_CONNECT_TIMEOUT_MS = 15_000;

/** Minimal no-dependency MCP Streamable HTTP client (JSON + SSE responses). */
export class McpClient {
	private sessionId: string | null = null;
	private nextId = 1;
	private readonly config: McpConfig;
	readonly endpointLabel: string;

	constructor(config: McpConfig = resolveMcpConfig()) {
		this.config = config;
		this.endpointLabel = displayMcpUrl(config.url) + " (" + config.source + ")";
	}

	private headers(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			...this.config.headers,
		};
		if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
		return headers;
	}

	private static parseSse(text: string, id: number): unknown {
		const payloads: string[] = [];
		for (const line of text.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.startsWith("data:")) payloads.push(trimmed.slice(5).trim());
		}
		for (const payload of payloads.reverse()) {
			if (!payload || payload === "[DONE]") continue;
			try {
				const parsed = JSON.parse(payload) as { id?: number };
				if (parsed && parsed.id === id) return parsed;
			} catch {
				/* skip malformed frame */
			}
		}
		throw new Error("MCP response did not contain a matching JSON-RPC result.");
	}

	private async post(method: string, params: unknown, expectResponse: boolean): Promise<unknown> {
		try {
			return await this.request(method, params, expectResponse);
		} catch (error) {
			throw new Error(redactMcpError(error, this.config));
		}
	}

	private async request(method: string, params: unknown, expectResponse: boolean): Promise<unknown> {
		const id = expectResponse ? this.nextId++ : undefined;
		const response = await fetch(this.config.url, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify(id === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", id, method, params }),
			signal: AbortSignal.timeout(MCP_CONNECT_TIMEOUT_MS),
		});
		const sessionId = response.headers.get("mcp-session-id");
		if (sessionId) this.sessionId = sessionId;
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`MCP ${method} failed: HTTP ${response.status} ${redactMcpError(text, this.config).slice(0, 200)}`.trim());
		}
		if (!expectResponse || text.trim() === "") return undefined;
		const contentType = response.headers.get("content-type") ?? "";
		const message = contentType.includes("text/event-stream")
			? McpClient.parseSse(text, id!)
			: this.parseJson(text);
		const err = (message as { error?: { message?: string } }).error;
		if (err) throw new Error(err.message ?? JSON.stringify(err));
		return (message as { result?: unknown }).result;
	}

	private parseJson(text: string): unknown {
		try {
			return JSON.parse(text);
		} catch {
			throw new Error("MCP response was not valid JSON");
		}
	}

	async connect(): Promise<void> {
		await this.post(
			"initialize",
			{
				protocolVersion: "2025-03-26",
				capabilities: {},
				clientInfo: { name: "pi-compute", version: "1.0.0" },
			},
			true,
		);
		await this.post("notifications/initialized", undefined, false);
	}

	async listTools(): Promise<McpToolInfo[]> {
		const result = (await this.post("tools/list", {}, true)) as { tools?: McpToolInfo[] } | undefined;
		return Array.isArray(result?.tools) ? result!.tools! : [];
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<McpContentPart[] | undefined> {
		const result = (await this.post("tools/call", { name, arguments: args }, true)) as
			| { content?: McpContentPart[]; isError?: boolean }
			| undefined;
		if (result?.isError) {
			const text = (result.content ?? [])
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n");
			throw new Error(redactMcpError(text || `MCP tool ${name} failed.`, this.config));
		}
		return result?.content;
	}
}
