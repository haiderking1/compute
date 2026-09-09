import type { McpContentPart, McpToolInfo } from "../../core/types.ts";

export const MCP_URL = process.env.EXA_MCP_URL ?? "https://mcp.exa.ai/mcp";
const MCP_CONNECT_TIMEOUT_MS = 15_000;

/** Minimal no-dependency MCP Streamable HTTP client (JSON + SSE responses). */
export class McpClient {
	private sessionId: string | null = null;
	private nextId = 1;

	private headers(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		};
		if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
		const key = process.env.EXA_API_KEY;
		if (key) headers.Authorization = `Bearer ${key}`;
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
		const id = expectResponse ? this.nextId++ : undefined;
		const response = await fetch(MCP_URL, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify(id === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", id, method, params }),
			signal: AbortSignal.timeout(MCP_CONNECT_TIMEOUT_MS),
		});
		const sessionId = response.headers.get("mcp-session-id");
		if (sessionId) this.sessionId = sessionId;
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`MCP ${method} failed: HTTP ${response.status} ${text.slice(0, 200)}`.trim());
		}
		if (!expectResponse || text.trim() === "") return undefined;
		const contentType = response.headers.get("content-type") ?? "";
		const message = contentType.includes("text/event-stream")
			? McpClient.parseSse(text, id!)
			: (JSON.parse(text) as { error?: { message?: string }; result?: unknown });
		const err = (message as { error?: { message?: string } }).error;
		if (err) throw new Error(err.message ?? JSON.stringify(err));
		return (message as { result?: unknown }).result;
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
			throw new Error(text || `MCP tool ${name} failed.`);
		}
		return result?.content;
	}
}
