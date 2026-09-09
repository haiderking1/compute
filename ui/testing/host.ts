import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export async function renderWithHost(kind: "success" | "error" | "skill" | "mixed" | "stream") {
  const renderer = fileURLToPath(new URL("../renderers.ts", import.meta.url));
  const hostRoot = import.meta.resolve("@earendil-works/pi-coding-agent");
  const script = String.raw`
    const root = ${JSON.stringify(hostRoot)};
    const { ToolExecutionComponent } = await import(new URL("./modes/interactive/components/tool-execution.js", root).href);
    const { initTheme } = await import(new URL("./modes/interactive/theme/theme.js", root).href);
    const { renderComputeCall, renderComputeResult } = await import(${JSON.stringify(renderer)});
    initTheme("dark", false);
    const kind = ${JSON.stringify(kind)};
    const skill = kind === "skill" || kind === "mixed";
    const args = { title: "Render regression", code: skill
      ? 'async () => workspace.read({ path: "skills/unslop/SKILL.md" })'
      : 'async () => "RENDER-ONCE"' };
    let redraws = 0;
    const component = new ToolExecutionComponent("compute", "test", args, { showImages: false },
      { renderShell: "self", renderCall: renderComputeCall, renderResult: renderComputeResult },
      { requestRender() { redraws++; } }, process.cwd());
    const calls = [{ provider: "workspace", method: "read", path: "skills/unslop/SKILL.md", is_error: false }];
    if (kind === "mixed") calls.push({ provider: "system", method: "exec", is_error: false });
    if (kind === "stream") component.updateResult({ content: [{ type: "text", text: "PARTIAL-ONLY" }], details: null }, true);
    component.updateResult({ content: [{ type: "text", text: "RENDER-ONCE" }],
      details: skill ? { codeModeCalls: calls } : null, isError: kind === "error" }, false);
    const before = component.render(120).join("\n");
    await new Promise(resolve => setImmediate(resolve));
    const after = component.render(120).join("\n");
    component.invalidate();
    component.setExpanded(true);
    const expanded = component.render(120).join("\n");
    await new Promise(resolve => setImmediate(resolve));
    console.log(JSON.stringify({ before, after, expanded, redraws, state: component.rendererState }));
  `;
  const child = Bun.spawn([process.execPath, "-e", script], { cwd: homedir(), stdout: "pipe", stderr: "pipe" });
  const [exit, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (exit !== 0) throw new Error(error);
  return JSON.parse(out);
}
