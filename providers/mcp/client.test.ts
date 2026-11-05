import { expect, spyOn, test } from "bun:test";
import { McpClient } from "./client.ts";
import type { McpConfig } from "./config.ts";
import { displayMcpUrl, redactMcpError } from "./redact.ts";

const config: McpConfig = {
	url: "https://mcp.exa.ai/mcp?exaApiKey=query-secret&tools=web_search_exa",
	headers: { Authorization: "Bearer header-secret" },
	source: "pi config",
};

test("sends the saved authenticated connection while showing a safe label", async () => {
	const calls: Array<{ url: unknown; headers: Headers }> = [];
	const fetch = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
		calls.push({ url, headers: new Headers(init?.headers) });
		const request = JSON.parse(String(init?.body));
		return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [] } }), {
			headers: { "Content-Type": "application/json", "mcp-session-id": "session-id" },
		});
	});
	try {
		const client = new McpClient(config);
		await client.connect();
		expect(await client.listTools()).toEqual([]);
		expect(calls).toHaveLength(3);
		for (const call of calls) {
			expect(call.url).toBe(config.url);
			expect(call.headers.get("authorization")).toBe("Bearer header-secret");
		}
		expect(calls[2].headers.get("mcp-session-id")).toBe("session-id");
		expect(client.endpointLabel).toBe("https://mcp.exa.ai/mcp (pi config)");
	} finally { fetch.mockRestore(); }
});

test("redacts URL credentials, query values, fragments and header tokens", () => {
	const url = "https://user:pass@example.com/mcp?exaApiKey=query%20secret#fragment-secret";
	expect(displayMcpUrl(url)).toBe("https://example.com/mcp");
	const message = redactMcpError(new Error(url + " query secret query%20secret header-secret"), { ...config, url });
	expect(message).not.toContain("secret");
	expect(message).not.toContain("user:pass");
	expect(message).toContain("[redacted]");
});

test("redacts reflected HTTP errors before truncating their text", async () => {
	const fetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response("x".repeat(190) + " query-secret header-secret " + config.url, { status: 401 }));
	try {
		const message = await new McpClient(config).listTools().then(() => "unexpected success", error => error.message);
		expect(message).toContain("HTTP 401");
		expect(message).not.toContain("query-secret");
		expect(message).not.toContain("header-secret");
		expect(message).not.toContain(" query-");
	} finally { fetch.mockRestore(); }
});

test("redacts JSON-RPC, transport and tool errors", async () => {
	const fetch = spyOn(globalThis, "fetch");
	try {
		fetch.mockResolvedValue(new Response(JSON.stringify({ error: { message: "query-secret header-secret" } }), { headers: { "Content-Type": "application/json" } }));
		await expect(new McpClient(config).listTools()).rejects.toThrow("[redacted] [redacted]");
		fetch.mockRejectedValue(new Error("failed to fetch " + config.url));
		await expect(new McpClient(config).listTools()).rejects.toThrow("failed to fetch [redacted]");
		fetch.mockResolvedValue(new Response(JSON.stringify({ result: { isError: true, content: [{ type: "text", text: "query-secret header-secret" }] } }), { headers: { "Content-Type": "application/json" } }));
		await expect(new McpClient(config).callTool("search", {})).rejects.toThrow("[redacted] [redacted]");
	} finally { fetch.mockRestore(); }
});

test("invalid JSON never echoes response contents", async () => {
	const fetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response('not json query-secret', { headers: { "Content-Type": "application/json" } }));
	try {
		await expect(new McpClient(config).listTools()).rejects.toThrow("MCP response was not valid JSON");
	} finally { fetch.mockRestore(); }
});
