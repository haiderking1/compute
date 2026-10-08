import { expect, test } from "bun:test";
import { buildCodeParameterDescription, buildHostDescription, HOST_DESCRIPTION_MAX_CHARS } from "./host-description.ts";

test("the MCP host description survives Claude Code's truncation and does not claim to be the only tool", () => {
	for (const claude of ["1", undefined]) {
		if (claude === undefined) delete process.env.CLAUDECODE;
		else process.env.CLAUDECODE = claude;
		const description = buildHostDescription();
		expect(description.length).toBeLessThanOrEqual(HOST_DESCRIPTION_MAX_CHARS);
		expect(description).not.toContain("ONLY tool");
		expect(description).not.toContain("unslop");
	}
});

test("provider declarations move to the code parameter", () => {
	const description = buildCodeParameterDescription();
	for (const method of ["read(input: WorkspaceReadInput)", "exec(input: SystemExecInput)", "declare const mcp"]) {
		expect(description).toContain(method);
	}
});
