import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { workerPath } from "./worker-path.ts";

test("workerPath resolves the split worker module", () => {
	const path = workerPath();
	expect(path).toBe(fileURLToPath(new URL("../worker.mjs", import.meta.url)));
	expect(existsSync(path)).toBe(true);
});
