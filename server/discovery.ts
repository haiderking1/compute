import { McpClient } from "../providers/mcp/client.ts";
import { renderMcpContent } from "../providers/mcp/content.ts";
import { toTypeBox } from "../providers/mcp/schema.ts";
import { getProviders, refreshProviders } from "../providers/catalog.ts";
import { toolText } from "../results/tool-result.ts";

/**
 * Add the remote MCP server's tools (Exa by default) under the `mcp` provider,
 * mirroring the Pi extension's session_start discovery. Returns how many were added.
 */
export async function discoverMcpMethods(): Promise<number> {
	const client = new McpClient();
	await client.connect();
	const tools = await client.listTools();
	const mcp = getProviders().find((provider) => provider.name === "mcp");
	if (!mcp) return 0;
	let added = 0;
	for (const tool of tools) {
		if (!tool?.name) continue;
		if (mcp.methods.some((method) => method.name === tool.name)) continue;
		mcp.methods.push({
			name: tool.name,
			description: tool.description?.trim().replace(/\s+/g, " ") || `Exa MCP tool: ${tool.name}`,
			schema: toTypeBox(tool.inputSchema),
			returns: "ComputeToolOutput",
			run: async (args) => toolText(renderMcpContent(await client.callTool(tool.name, args ?? {}), tool.name)),
		});
		added++;
	}
	if (added > 0) refreshProviders();
	return added;
}
