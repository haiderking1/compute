import { describe, expect, mock, test } from "bun:test";

class MockContainer {
	children: unknown[] = [];
	addChild(child: unknown) { this.children.push(child); }
	invalidate() {}
	render() { return []; }
}
class Box extends MockContainer {}
class Container extends MockContainer {}
class Text {
	constructor(public text = "", ..._rest: unknown[]) {}
	setText(text: string) { this.text = text; }
	setCustomBgFn(_fn: unknown) {}
	invalidate() {}
	render() { return [this.text]; }
}
mock.module("@earendil-works/pi-tui", () => ({
	Box,
	Container,
	Text,
	truncateToWidth: (text: string) => text,
}));

const { renderComputeCall, renderComputeResult } = await import("./renderers.ts");
type ComputeRenderState = import("./renderers.ts").ComputeRenderState;

const directSkillCode = 'async () => workspace.read({ path: "skills/unslop/SKILL.md" })';
const interpolatedSkillCode =
	"async () => workspace.read({ path: " + String.fromCharCode(96) + "skills/$" + "{name}/SKILL.md" + String.fromCharCode(96) + " })";
const skillTrace = {
	codeModeCalls: [
		{ provider: "workspace", method: "read", path: "skills/unslop/SKILL.md", is_error: false },
	],
};
const theme = {
	fg: (_color: never, text: string) => text,
	bg: (_color: never, text: string) => text,
	bold: (text: string) => text,
};

function resultContext(args: { code?: unknown }, state: ComputeRenderState) {
	let invalidations = 0;
	return {
		context: { args, state, invalidate: () => invalidations++ },
		invalidations: () => invalidations,
	};
}

describe("compute renderers", () => {
	test("uses source classification only while pending", () => {
		const state: ComputeRenderState = {};
		expect(renderComputeCall({ code: directSkillCode }, theme, { state })).toBeInstanceOf(Text);
		expect(renderComputeCall({ code: 'async () => "normal"' }, theme, { state: {} })).toBeInstanceOf(Box);
	});

	test("keeps a completed direct pure skill read suppressed", async () => {
		const state: ComputeRenderState = {};
		const harness = resultContext({ code: directSkillCode }, state);
		const result = renderComputeResult(
			{ content: [{ type: "text", text: "skill body" }], details: skillTrace },
			{},
			theme,
			harness.context,
		);
		expect(result).toBeInstanceOf(Container);
		expect(state).toEqual({ done: true, isError: false, isSkillLoad: true });
		expect(harness.invalidations()).toBe(0);
		await Promise.resolve();
		expect(harness.invalidations()).toBe(1);
		expect(renderComputeCall({ code: directSkillCode }, theme, { state })).toBeInstanceOf(Text);
	});

	test("turns a static false positive into a normal final call and visible result", () => {
		const state: ComputeRenderState = {};
		const harness = resultContext({ code: directSkillCode }, state);
		const mixed = {
			codeModeCalls: [
				...skillTrace.codeModeCalls,
				{ provider: "system", method: "exec", is_error: false },
			],
		};
		expect(
			renderComputeResult(
				{ content: [{ type: "text", text: "normal output" }], details: mixed },
				{},
				theme,
				harness.context,
			),
		).toBeInstanceOf(Box);
		expect(state.isSkillLoad).toBe(false);
		expect(renderComputeCall({ code: directSkillCode }, theme, { state })).toBeInstanceOf(Box);
	});

	test("shows errors with no executed calls and does not re-invalidate stable final state", async () => {
		const state: ComputeRenderState = {};
		const harness = resultContext({ code: directSkillCode }, state);
		const result = { content: [{ type: "text", text: "compute failed: syntax" }], details: null, isError: true };
		expect(renderComputeResult(result, {}, theme, harness.context)).toBeInstanceOf(Box);
		expect(state).toEqual({ done: true, isError: true, isSkillLoad: false });
		expect(harness.invalidations()).toBe(0);
		await Promise.resolve();
		expect(harness.invalidations()).toBe(1);
		renderComputeResult(result, {}, theme, harness.context);
		expect(harness.invalidations()).toBe(1);
	});

	test("keeps alias, interpolation, and global access visible even with a pure trace", () => {
		for (const code of [
			'async () => { const read = workspace.read; return read({ path: "skills/a/SKILL.md" }); }',
			interpolatedSkillCode,
			'async () => globalThis.workspace.read({ path: "skills/a/SKILL.md" })',
		]) {
			const state: ComputeRenderState = {};
			const harness = resultContext({ code }, state);
			expect(
				renderComputeResult(
					{ content: [{ type: "text", text: "visible" }], details: skillTrace },
					{},
					theme,
					harness.context,
				),
			).toBeInstanceOf(Box);
		}
	});
});
