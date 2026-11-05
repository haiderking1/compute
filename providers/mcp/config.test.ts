import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMcpConfig } from "./config.ts";

let dir: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "compute-mcp-config-"));
	env = { PI_CODING_AGENT_DIR: dir };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function save(exa: unknown): void {
	writeFileSync(join(dir, "mcp.json"), JSON.stringify({ mcpServers: { exa } }));
}

test("uses the default endpoint only when no saved Exa connection exists", () => {
	expect(resolveMcpConfig(env)).toEqual({ url: "https://mcp.exa.ai/mcp", headers: {}, source: "default" });
	save(undefined);
	expect(resolveMcpConfig(env).source).toBe("default");
});

test("inherits the saved authenticated URL without changing it", () => {
	const url = "https://mcp.exa.ai/mcp?exaApiKey=saved-secret&tools=web_search_exa";
	save({ url });
	expect(resolveMcpConfig(env)).toEqual({ url, headers: {}, source: "pi config" });
});

test("inherits headers and resolves environment references", () => {
	save({ url: "https://mcp.exa.ai/mcp", headers: { Authorization: "Bearer ${SAVED_KEY}", "X-Account": "account" } });
	env.SAVED_KEY = "header-secret";
	expect(resolveMcpConfig(env).headers).toEqual({ Authorization: "Bearer header-secret", "X-Account": "account" });
});

test("resolves environment references in the saved URL", () => {
	save({ url: "https://mcp.exa.ai/mcp?exaApiKey=${SAVED_KEY}" });
	env.SAVED_KEY = "url-secret";
	expect(resolveMcpConfig(env).url).toEndWith("exaApiKey=url-secret");
});

test("an explicit endpoint never inherits saved credentials", () => {
	save({ url: "https://mcp.exa.ai/mcp?exaApiKey=saved-secret", headers: { Authorization: "Bearer saved-header" } });
	env.EXA_MCP_URL = "https://other.example/mcp";
	expect(resolveMcpConfig(env)).toEqual({ url: env.EXA_MCP_URL, headers: {}, source: "environment" });
	env.EXA_API_KEY = "explicit-secret";
	expect(resolveMcpConfig(env).headers).toEqual({ Authorization: "Bearer explicit-secret" });
});

test("an explicit API key preserves the environment-only behavior", () => {
	save({ url: "https://other.example/mcp?exaApiKey=saved-secret" });
	env.EXA_API_KEY = "explicit-secret";
	expect(resolveMcpConfig(env)).toEqual({ url: "https://mcp.exa.ai/mcp", headers: { Authorization: "Bearer explicit-secret" }, source: "environment" });
});

test("does not bypass a disabled saved connection", () => {
	save({ url: "https://mcp.exa.ai/mcp", enabled: false });
	expect(() => resolveMcpConfig(env)).toThrow("exa is disabled");
});

test("reports invalid config without echoing its contents", () => {
	writeFileSync(join(dir, "mcp.json"), '{"secret":"do-not-show"');
	expect(() => resolveMcpConfig(env)).toThrow("invalid JSON in user-level mcp.json");
	try { resolveMcpConfig(env); } catch (error) { expect(String(error)).not.toContain("do-not-show"); }
});

test("does not silently fall back when the file cannot be read", () => {
	mkdirSync(join(dir, "mcp.json"));
	expect(() => resolveMcpConfig(env)).toThrow("could not read user-level mcp.json");
});

test("rejects unsupported transports, OAuth and invalid headers", () => {
	for (const entry of [null, [], { command: "server" }, { url: "https://example.com", type: "sse" }, { url: "https://example.com", oauth: {} }, { url: "https://example.com", headers: [] }, { url: "https://example.com", headers: { Authorization: 123 } }]) {
		save(entry);
		expect(() => resolveMcpConfig(env)).toThrow();
	}
});

test("does not execute credential commands or ignore missing variables", () => {
	save({ url: "https://mcp.exa.ai/mcp", headers: { Authorization: "!echo secret" } });
	expect(() => resolveMcpConfig(env)).toThrow("command-based MCP credentials are not supported");
	save({ url: "https://mcp.exa.ai/mcp", headers: { Authorization: "Bearer ${MISSING_KEY}" } });
	expect(() => resolveMcpConfig(env)).toThrow("missing MCP environment variable MISSING_KEY");
});

test("validates URLs without disclosing credentials", () => {
	for (const url of ["bad-secret-url", "file:///private/secret"]) {
		save({ url });
		expect(() => resolveMcpConfig(env)).toThrow("MCP URL");
	}
});

test("reads updated credentials when a new client resolves configuration", () => {
	save({ url: "https://mcp.exa.ai/mcp?exaApiKey=first" });
	expect(resolveMcpConfig(env).url).toEndWith("=first");
	save({ url: "https://mcp.exa.ai/mcp?exaApiKey=second" });
	expect(resolveMcpConfig(env).url).toEndWith("=second");
});
