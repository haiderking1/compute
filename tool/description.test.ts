import { expect, test } from "bun:test";
import { buildComputeDescription } from "./description.ts";

test("compute does not require the unslop skill", () => {
	expect(buildComputeDescription()).not.toContain("unslop");
});
