import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

describe("compute extension registration", () => {
	test("registers the tool, hooks, flag, and command through the public facade", async () => {
		const entry = fileURLToPath(new URL("../index.ts", import.meta.url));
		const script = `const module = await import(${JSON.stringify(entry)});
const state = { flags: [], tools: [], hooks: [], commands: [] };
const pi = {
  registerFlag(name) { state.flags.push(name); },
  registerTool(tool) { state.tools.push(tool.name); },
  on(name) { state.hooks.push(name); },
  registerCommand(name) { state.commands.push(name); },
  getActiveTools() { return ["compute"]; },
  getFlag() { return false; },
  setActiveTools() {},
};
module.default(pi);
console.log(JSON.stringify({ exports: Object.keys(module).sort(), ...state }));`;
		const child = Bun.spawn([process.execPath, "-e", script], {
			cwd: homedir(),
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toEqual({
			exports: ["default", "isSkillLoad", "makeComputeToolDefinition"],
			flags: ["keep-builtin-tools"],
			tools: ["compute"],
			hooks: ["session_start", "before_agent_start"],
			commands: ["compute"],
		});
	}, 10_000);
});
