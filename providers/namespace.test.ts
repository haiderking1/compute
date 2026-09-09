import { expect, test } from "bun:test";
import { getProviders, findMethod } from "./catalog.ts";
import { buildDeclarations } from "../schema/declarations.ts";
import { resolveProviderCall } from "../runtime/bridge.ts";
import { ComputeTrace } from "../runtime/trace.ts";

test("builtins expose shell execution under system and reserve mcp for discovery", () => {
  expect(getProviders().map(provider => provider.name)).toEqual(["workspace", "system", "mcp"]);
  expect(findMethod("system", "bash")).toBeDefined();
  expect(findMethod("system", "exec")).toBeDefined();
  expect(findMethod("raid", "bash")).toBeUndefined();
  expect(findMethod("mcp", "bash")).toBeUndefined();
  const declarations = buildDeclarations(getProviders());
  expect(declarations).toContain("type SystemBashInput");
  expect(declarations).toContain("declare const mcp:");
  expect(declarations).not.toMatch(/raid/i);
});

test("obsolete and unknown providers return explicit bridge errors", async () => {
  for (const provider of ["raid", "unknown"]) {
    const result = JSON.parse(await resolveProviderCall(provider, "bash", {}, {
      cwd: process.cwd(), signal: undefined, execGroups: new Set(),
    }, new ComputeTrace()));
    expect(result).toEqual({ ok: false, error: "Unknown Code Mode method " + provider + ".bash." });
  }
});
