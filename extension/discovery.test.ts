import { expect, test, spyOn } from "bun:test";
import computeExtension from "./register.ts";
import { McpClient } from "../providers/mcp/client.ts";
import { getProviders, refreshProviders, findMethod } from "../providers/catalog.ts";
import { buildDeclarations } from "../schema/declarations.ts";

test("session discovery registers MCP schemas and methods only under mcp", async () => {
  const connect = spyOn(McpClient.prototype, "connect").mockResolvedValue(undefined);
  const list = spyOn(McpClient.prototype, "listTools").mockResolvedValue([
    { name: "namespace_probe", description: "Test discovery", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
    { name: "bash", inputSchema: { type: "object" } },
  ]);
  const call = spyOn(McpClient.prototype, "callTool").mockResolvedValue([{ type: "text", text: "discovered-result" }]);
  const hooks = new Map<string, Function>();
  const tools: any[] = [];
  const provider = getProviders().find(provider => provider.name === "mcp")!;
  const original = [...provider.methods];
  try {
    computeExtension({
      registerFlag() {}, registerCommand() {}, registerTool(tool: unknown) { tools.push(tool); },
      on(name: string, hook: Function) { hooks.set(name, hook); },
      getActiveTools() { return ["compute"]; }, getFlag() { return false; }, setActiveTools() {},
    } as any);
    hooks.get("session_start")!({}, { ui: { notify() {} } });
    for (let attempt = 0; tools.length < 2 && attempt < 100; attempt++) await Bun.sleep(5);
    expect(tools).toHaveLength(2);
    const declarations = buildDeclarations(getProviders());
    expect(declarations).toContain("type McpNamespaceProbeInput = { query: string }");
    expect(declarations).toContain("namespace_probe(input: McpNamespaceProbeInput): Promise<ComputeToolOutput>");
    expect(tools[1].description).toContain("declare const mcp:");
    expect(tools[1].description).not.toMatch(/raid/i);
    expect(findMethod("raid", "namespace_probe")).toBeUndefined();
    expect(findMethod("system", "namespace_probe")).toBeUndefined();
    expect(findMethod("mcp", "bash")).toBeDefined();
    expect(findMethod("system", "bash")!.method.run).not.toBe(findMethod("mcp", "bash")!.method.run);
    const result = await findMethod("mcp", "namespace_probe")!.method.run({ query: "test" }, { cwd: process.cwd(), signal: undefined, execGroups: new Set() });
    expect(call).toHaveBeenCalledWith("namespace_probe", { query: "test" });
    expect(JSON.stringify(result)).toContain("discovered-result");
    const workerResult = await tools[1].execute("namespace-test", {
      title: "Test discovered MCP worker method", timeout: 10,
      code: 'async () => ({ value: await mcp.namespace_probe({ query: "worker" }), legacy: typeof raid })',
    }, undefined, undefined, { cwd: process.cwd(), model: { input: ["text"] } });
    expect(workerResult.isError).not.toBe(true);
    expect(workerResult.content[0].text).toContain("discovered-result");
    expect(workerResult.content[0].text).toContain('"legacy": "undefined"');
    expect(workerResult.details.codeModeCalls[0].provider).toBe("mcp");
    expect(call).toHaveBeenCalledWith("namespace_probe", { query: "worker" });
  } finally {
    provider.methods.splice(0, provider.methods.length, ...original);
    refreshProviders();
    connect.mockRestore(); list.mockRestore(); call.mockRestore();
  }
});
