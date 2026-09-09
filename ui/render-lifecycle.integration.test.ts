import { expect, test } from "bun:test";
import { renderWithHost } from "./testing/host.ts";

test("real Pi host displays completed success and error results exactly once", async () => {
  for (const kind of ["success", "error", "stream"] as const) {
    const result = await renderWithHost(kind);
    for (const output of [result.before, result.after, result.expanded]) {
      expect(output.split("RENDER-ONCE").length - 1).toBe(1);
      expect(output).not.toContain("PARTIAL-ONLY");
    }
    expect(result.state.isError).toBe(kind === "error");
    expect(result.redraws).toBe(1);
  }
}, 20000);

test("real Pi host keeps pure skill results hidden and mixed results visible once", async () => {
  const skill = await renderWithHost("skill");
  expect(skill.after).not.toContain("RENDER-ONCE");
  expect(skill.state.isSkillLoad).toBe(true);
  const mixed = await renderWithHost("mixed");
  expect(mixed.after.split("RENDER-ONCE").length - 1).toBe(1);
  expect(mixed.state.isSkillLoad).toBe(false);
}, 20000);
