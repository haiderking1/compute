import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { McpClient, MCP_URL } from "../providers/mcp/client.ts";
import { renderMcpContent } from "../providers/mcp/content.ts";
import { toTypeBox } from "../providers/mcp/schema.ts";
import { getProviders, refreshProviders } from "../providers/catalog.ts";
import { toolText } from "../results/tool-result.ts";
import { workerPath } from "../runtime/worker-path.ts";
import { makeComputeToolDefinition } from "../tool/definition.ts";

// (prompt guidance lives in the compute tool description and zz-tools-only-prompt.ts)

export default function computeExtension(pi: ExtensionAPI) {
	// Raid parity: `model_receives_one_code_mode_tool` asserts the model sees
	// exactly ONE tool — compute. Provider methods exist as hidden aliases
	// (exposed_to_model() == false), and Raid's /tools panel toggles provider
	// capabilities, never model-facing tools. pi has no per-tool visibility
	// flag, so we get the same result by making compute the only ACTIVE tool.
	// Everything else stays registered but inactive; the built-ins remain
	// reachable through the workspace/system/raid providers.
	const FORCE_FLAG = "keep-builtin-tools";
	pi.registerFlag(FORCE_FLAG, {
		description: "Keep read/bash/edit/write active alongside compute (disables Raid's one-tool model)",
		type: "boolean",
		default: false,
	});

/**
 * Notify through a session ctx without crashing when the ctx went stale.
 * Session replacement (newSession/fork/switchSession/reload) invalidates
 * captured ctx objects and even READING a stale ctx's ui getter throws —
 * so the property access itself must sit inside the try block.
 */
function safeNotify(
	ctx: unknown,
	message: string,
	level?: "info" | "warning" | "error",
): void {
	try {
		(ctx as { ui: { notify(text: string, level?: string): void } }).ui.notify(message, level);
	} catch {
		// stale ctx after session replacement — drop the notification
	}
}

	const enforceComputeOnly = (ctx: { ui?: { notify(text: string, level?: string): void } }): void => {
		const active = pi.getActiveTools();
		if (pi.getFlag(FORCE_FLAG)) return;
		// Respect an explicit user narrowing that excludes compute entirely.
		if (!active.includes("compute")) return;
		if (active.length === 1 && active[0] === "compute") return;
		// The subagent tool (pi-sub-agent) may live next to compute: delegated
		// child sessions load the same ~/.pi/agent config, so they inherit this
		// rule — which doubles as the anti-fan-out guarantee.
		if (active.includes("subagent")) {
			if (active.length === 2 && active.includes("compute")) return;
			pi.setActiveTools(["compute", "subagent"]);
			try {
				ctx.ui?.notify("compute: kept subagent alongside compute (pi-sub-agent)", "info");
			} catch {
				// stale ctx — the prune itself already applied, drop the notification
			}
			return;
		}
		pi.setActiveTools(["compute"]);
		try {
			ctx.ui?.notify(
				"compute: model limited to the compute tool only (Raid parity) — pass --keep-builtin-tools to restore read/bash/edit/write",
				"info",
			);
		} catch {
			// stale ctx — the prune itself already applied, drop the notification
		}
	};

	pi.registerTool(makeComputeToolDefinition());

	// Discover MCP web tools (raid.*) and re-register so the generated
	// declarations include them. pi replaces a tool registered under the same
	// name and refreshes the active tool set.
	let discoveryStarted = false;
	pi.on("session_start", (_event, ctx) => {
		// Run after every extension's own session_start handler so late-registered
		// tools are already in the active set when we prune it down to compute.
		setTimeout(() => enforceComputeOnly(ctx), 0);
		if (discoveryStarted) return;
		discoveryStarted = true;
		void (async () => {
			const client = new McpClient();
			await client.connect();
			const tools = await client.listTools();
			const raid = getProviders().find((provider) => provider.name === "raid");
			if (!raid) return;
			let added = 0;
			for (const tool of tools) {
				if (!tool?.name) continue;
				if (raid.methods.some((method) => method.name === tool.name)) continue;
				const schema = toTypeBox(tool.inputSchema);
				const description = tool.description?.trim().replace(/\s+/g, " ") || `Exa MCP tool: ${tool.name}`;
				raid.methods.push({
					name: tool.name,
					description,
					schema,
					returns: "RaidToolOutput",
					run: async (args) => {
						const content = await client.callTool(tool.name, args ?? {});
						return toolText(renderMcpContent(content, tool.name));
					},
				});
				added++;
			}
			if (added > 0) {
				refreshProviders();
				pi.registerTool(makeComputeToolDefinition());
				// raid.* web methods are reachable through compute only, so re-apply
				// the one-tool rule after the re-registration refreshed the tool set.
				// The captured ctx can go stale if the session is replaced while MCP
				// discovery connects — enforceComputeOnly guards stale ui access.
				setTimeout(() => enforceComputeOnly(ctx), 0);
				safeNotify(ctx, `compute: registered ${added} raid.* web tool(s) from ${MCP_URL}`, "info");
			}
		})().catch((error: unknown) => {
			safeNotify(ctx, `compute: MCP discovery unavailable (${error instanceof Error ? error.message : String(error)})`, "warning");
		});
	});

	// Actively steer the model toward compute in the system prompt, and enforce
	// the one-tool rule per turn (before_agent_start fires after all extensions
	// have registered, so the active set is authoritative here).
	// NOTE: the system prompt is owned by zz-tools-only-prompt.ts, which rebuilds
	// it from CUSTOM_INSTRUCTIONS + a tools section. Two extensions returning
	// systemPrompt chain, and the last one wins — so compute does NOT touch
	// the prompt. Enforcement is purely setActiveTools, and the prompt
	// extension reads the live active set so its tools list stays accurate.
	// The full provider contract lives in the compute tool description,
	// which the model sees regardless of which extension owns the prompt.

	// pi re-derives the active tool set per turn, so a session_start prune
	// does not stick — re-assert every turn. Side effect only: no systemPrompt
	// return, so this never fights zz-tools-only-prompt.ts for prompt ownership.
	pi.on("before_agent_start", () => {
		enforceComputeOnly({ ui: { notify: () => {} } });
	});
	pi.registerCommand("compute", {
		description: "Show compute tool status and available providers",
		handler: async (_args, ctx) => {
			const lines = ["Compute tool providers:"];
			for (const provider of getProviders()) {
				lines.push(`  ${provider.name}: ${provider.methods.map((method) => method.name).join(", ")}`);
			}
			lines.push(`Active model tools: ${pi.getActiveTools().join(", ")}`);
			lines.push(`Worker: ${workerPath()}`);
			lines.push(`MCP: ${MCP_URL}`);
			safeNotify(ctx, lines.join("\n"), "info");
		},
	});
}
