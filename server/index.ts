/**
 * MCP stdio server exposing the compute tool to MCP hosts such as Claude Code.
 *
 *   claude mcp add --scope user compute -- node /absolute/path/to/compute/server/index.ts
 *
 * Plans run relative to COMPUTE_CWD, or the directory the host launched the server in.
 */
import { makeComputeToolDefinition } from "../tool/definition.ts";
import { buildCodeParameterDescription, buildHostDescription } from "../tool/host-description.ts";
import { discoverMcpMethods } from "./discovery.ts";
import { StdioRpc } from "./rpc.ts";

const SERVER_INFO = { name: "compute", version: "0.1.0" };
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

const cwd = process.env.COMPUTE_CWD || process.cwd();
const rpc = new StdioRpc();

// Rebuilt after MCP discovery so the generated declarations include mcp.* methods.
let tool = makeComputeToolDefinition();

// Pi's description and guidelines assume compute is the only tool; MCP hosts get their own, short enough to survive truncation.
function listedTool() {
	// TypeBox schemas are plain JSON Schema once serialized.
	const inputSchema = JSON.parse(JSON.stringify(tool.parameters));
	inputSchema.properties.code.description = buildCodeParameterDescription();
	return { name: tool.name, title: tool.label, description: buildHostDescription(), inputSchema };
}

rpc.onRequest("initialize", async (params) => ({
	protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : DEFAULT_PROTOCOL_VERSION,
	capabilities: { tools: { listChanged: true } },
	serverInfo: SERVER_INFO,
}));

rpc.onRequest("ping", async () => ({}));

rpc.onRequest("tools/list", async () => ({ tools: [listedTool()] }));

rpc.onRequest("tools/call", async (params, signal) => {
	if (params.name !== tool.name) throw new Error(`Unknown tool: ${String(params.name)}`);
	const args = (params.arguments ?? {}) as { title?: string; code?: string; timeout?: number };
	const result = await tool.execute("", args, signal, undefined, { cwd, model: { input: ["text", "image"] } });
	return { content: result.content, isError: result.isError ?? false };
});

rpc.onNotification("notifications/cancelled", (params) => {
	const id = params.requestId;
	if (typeof id === "number" || typeof id === "string") rpc.cancel(id);
});

rpc.onNotification("notifications/initialized", () => {
	discoverMcpMethods()
		.then((added) => {
			if (added === 0) return;
			tool = makeComputeToolDefinition();
			rpc.notify("notifications/tools/list_changed");
		})
		.catch((error: unknown) => {
			process.stderr.write(`compute: MCP discovery unavailable (${error instanceof Error ? error.message : String(error)})\n`);
		});
});

rpc.listen();
