import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ComputeTrace } from "./trace.ts";
import { runWorker } from "./worker.ts";
import { workerPath } from "./worker-path.ts";

test("workerPath resolves the split worker module", () => {
	const path = workerPath();
	expect(path).toBe(fileURLToPath(new URL("../worker.mjs", import.meta.url)));
	expect(existsSync(path)).toBe(true);
});

test("a worker that cannot spawn rejects the plan instead of crashing or hanging", async () => {
	const saved = process.env.PI_COMPUTE_NODE;
	process.env.PI_COMPUTE_NODE = "/nonexistent/compute-test-node";
	try {
		await expect(runWorker("async () => 1", undefined, tmpdir(), undefined, new ComputeTrace())).rejects.toThrow(
			"Could not start compute worker",
		);
	} finally {
		if (saved === undefined) delete process.env.PI_COMPUTE_NODE;
		else process.env.PI_COMPUTE_NODE = saved;
	}
});
