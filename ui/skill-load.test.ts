import { describe, expect, test } from "bun:test";
import { isSkillLoad, isSkillLoadTrace } from "./skill-load.ts";

const interpolatedSkillCode =
	"async () => workspace.read({ path: " + String.fromCharCode(96) + "skills/$" + "{name}/SKILL.md" + String.fromCharCode(96) + " })";
const skillCall = (path = "/home/me/.pi/agent/skills/unslop/SKILL.md", isError = false) => ({
	provider: "workspace",
	method: "read",
	path,
	is_error: isError,
});

describe("isSkillLoad", () => {
	test("accepts one direct skill read and preserves the optional title input", () => {
		expect(
			isSkillLoad({
				title: "Load writing guidance",
				code: 'async () => await workspace.read({ path: "/home/me/.pi/agent/skills/unslop/SKILL.md" })',
			}),
		).toBe(true);
	});

	test("accepts multiple direct skill reads", () => {
		expect(
			isSkillLoad({
				code: 'async () => Promise.all([workspace.read({ path: "skills/a/SKILL.md" }), workspace["read"]({ path: "skills/b/SKILL.md" })])',
			}),
		).toBe(true);
	});

	test("rejects mixed skill and provider plans", () => {
		expect(
			isSkillLoad({
				code: 'async () => Promise.all([workspace.read({ path: "/skills/unslop/SKILL.md" }), workspace.glob({ pattern: "/home/*.sh" })])',
			}),
		).toBe(false);
		expect(
			isSkillLoad({
				code: 'async () => { const skill = await workspace.read({ path: "skills/a/SKILL.md" }); return system.exec({ argv: ["true"] }); }',
			}),
		).toBe(false);
		expect(
			isSkillLoad({
				code: 'async () => Promise.all([workspace.read({ path: "skills/a/SKILL.md" }), workspace.read({ path: "/etc/hosts" })])',
			}),
		).toBe(false);
	});

	test("rejects mentions, template interpolation, aliases, and global access", () => {
		expect(isSkillLoad({ code: 'async () => "skills/unslop/SKILL.md"' })).toBe(false);
		expect(isSkillLoad({ code: interpolatedSkillCode })).toBe(false);
		expect(
			isSkillLoad({
				code: 'async () => { const read = workspace.read; return read({ path: "skills/a/SKILL.md" }); }',
			}),
		).toBe(false);
		expect(
			isSkillLoad({ code: 'async () => globalThis.workspace.read({ path: "skills/a/SKILL.md" })' }),
		).toBe(false);
	});

	test("ignores provider-looking text in comments and strings", () => {
		expect(
			isSkillLoad({
				code: 'async () => { /* raid.bash({}) */ const note = "system.exec({})"; return workspace.read({ path: "skills/a/SKILL.md" }); }',
			}),
		).toBe(true);
	});

	test("rejects dynamic paths and incomplete plans", () => {
		expect(isSkillLoad({ code: "async () => workspace.read({ path: skillPath })" })).toBe(false);
		expect(isSkillLoad({})).toBe(false);
		expect(isSkillLoad({ code: 'async () => workspace.read({ path: "skills/a/SKILL.md" }' })).toBe(false);
	});
});

describe("isSkillLoadTrace", () => {
	test("accepts nonempty pure skill-read traces, including read errors", () => {
		expect(isSkillLoadTrace({ codeModeCalls: [skillCall()] })).toBe(true);
		expect(isSkillLoadTrace({ codeModeCalls: [skillCall("skills/a/SKILL.md"), skillCall("skills/b/SKILL.md", true)] })).toBe(true);
	});

	test("rejects empty, malformed, and pathless traces", () => {
		expect(isSkillLoadTrace(null)).toBe(false);
		expect(isSkillLoadTrace({})).toBe(false);
		expect(isSkillLoadTrace({ codeModeCalls: [] })).toBe(false);
		expect(isSkillLoadTrace({ codeModeCalls: [{ provider: "workspace", method: "read", is_error: true }] })).toBe(false);
		expect(isSkillLoadTrace({ codeModeCalls: [null] })).toBe(false);
	});

	test("rejects ordinary reads and every mixed provider trace", () => {
		expect(isSkillLoadTrace({ codeModeCalls: [skillCall("/etc/hosts")] })).toBe(false);
		expect(
			isSkillLoadTrace({
				codeModeCalls: [skillCall(), { provider: "workspace", method: "glob", is_error: false }],
			}),
		).toBe(false);
		expect(
			isSkillLoadTrace({
				codeModeCalls: [skillCall(), { provider: "system", method: "exec", is_error: false }],
			}),
		).toBe(false);
	});
});
