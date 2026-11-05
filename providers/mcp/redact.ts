import type { McpConfig } from "./config.ts";

export function displayMcpUrl(url: string): string {
	const parsed = new URL(url);
	return parsed.origin + parsed.pathname;
}

export function redactMcpError(error: unknown, config: McpConfig): string {
	let message = error instanceof Error ? error.message : String(error);
	const url = new URL(config.url);
	const secrets = new Set([config.url, url.username, url.password, url.hash.slice(1), ...url.searchParams.values()]);
	for (const value of Object.values(config.headers)) {
		secrets.add(value);
		if (/^Bearer /i.test(value)) secrets.add(value.slice(7));
	}
	for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
		message = message.replaceAll(secret, "[redacted]").replaceAll(encodeURIComponent(secret), "[redacted]");
	}
	return message;
}
