import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_URL = "https://mcp.exa.ai/mcp";

export interface McpConfig {
	url: string;
	headers: Record<string, string>;
	source: "environment" | "pi config" | "default";
}

function expand(value: string, env: NodeJS.ProcessEnv): string {
	if (value.startsWith("!")) throw new Error("compute: command-based MCP credentials are not supported; use a literal or environment variable");
	return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
		if (!env[name]) throw new Error("compute: missing MCP environment variable " + name);
		return env[name]!;
	});
}

function validate(config: McpConfig): McpConfig {
	let url: URL;
	try {
		url = new URL(config.url);
	} catch {
		throw new Error("compute: invalid Exa MCP URL");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("compute: Exa MCP URL must use HTTP or HTTPS");
	return config;
}

export function resolveMcpConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
	if (env.EXA_MCP_URL || env.EXA_API_KEY) {
		return validate({
			url: env.EXA_MCP_URL || DEFAULT_URL,
			headers: env.EXA_API_KEY ? { Authorization: "Bearer " + env.EXA_API_KEY } : {},
			source: "environment",
		});
	}

	const dir = env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	const path = join(dir.startsWith("~/") ? join(homedir(), dir.slice(2)) : dir, "mcp.json");
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { url: DEFAULT_URL, headers: {}, source: "default" };
		throw new Error("compute: could not read user-level mcp.json");
	}
	let entry: Record<string, unknown>;
	try {
		entry = JSON.parse(text)?.mcpServers?.exa;
	} catch {
		throw new Error("compute: invalid JSON in user-level mcp.json");
	}
	if (entry === undefined) return { url: DEFAULT_URL, headers: {}, source: "default" };
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("compute: invalid exa entry in user-level mcp.json");
	if (entry.enabled === false) throw new Error("compute: exa is disabled in user-level mcp.json");
	if (entry.command || (entry.type && !["http", "streamable-http"].includes(String(entry.type))) || typeof entry.url !== "string") {
		throw new Error("compute: saved exa connection must use an HTTP MCP URL");
	}
	if (entry.oauth) throw new Error("compute: saved Exa OAuth is not supported; use an API key URL or header");
	if (entry.headers !== undefined && (!entry.headers || typeof entry.headers !== "object" || Array.isArray(entry.headers))) {
		throw new Error("compute: invalid headers in saved exa connection");
	}
	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(entry.headers ?? {})) {
		if (typeof value !== "string") throw new Error("compute: saved Exa headers must be strings");
		headers[name] = expand(value, env);
	}
	return validate({ url: expand(entry.url, env), headers, source: "pi config" });
}
