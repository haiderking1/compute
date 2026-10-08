import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** Drive the real MCP stdio server under Node, one request at a time. */
async function startServer(cwd: string) {
	const entry = fileURLToPath(new URL("./index.ts", import.meta.url));
	const child = Bun.spawn([process.env.PI_COMPUTE_NODE || "node", entry], {
		cwd,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
	let buffered = "";
	let nextId = 1;
	async function request(method: string, params: Record<string, unknown>) {
		const id = nextId++;
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		child.stdin.flush();
		for (;;) {
			const newline = buffered.indexOf("\n");
			if (newline >= 0) {
				const line = buffered.slice(0, newline);
				buffered = buffered.slice(newline + 1);
				const message = JSON.parse(line);
				if (message.id === id) return message;
				continue;
			}
			const { value, done } = await reader.read();
			if (done) throw new Error(`server exited before answering ${method}`);
			buffered += value;
		}
	}
	const callPlan = (code: string) => request("tools/call", { name: "compute", arguments: { title: "test", code } });
	return { child, request, callPlan };
}

test("a missing binary in system.exec returns a structured rejection and the server keeps serving", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-compute-server-test-"));
	directories.push(cwd);
	const server = await startServer(cwd);
	try {
		await server.request("initialize", { protocolVersion: "2025-06-18" });
		const failing = await server.callPlan(`async () => {
			const settled = await Promise.allSettled([
				workspace.read({ path: "does/not/exist.txt" }),
				system.exec({ argv: ["compute-test-missing-binary"] }),
				system.bash({ command: "true", cwd: "missing/dir" }),
			]);
			return settled.map((entry) => entry.status === "fulfilled" ? entry.value : entry.reason);
		}`);
		expect(failing.error).toBeUndefined();
		const reasons = JSON.parse(failing.result.content[0].text);
		expect(reasons.map(({ provider, method }: { provider: string; method: string }) => `${provider}.${method}`)).toEqual([
			"workspace.read",
			"system.exec",
			"system.bash",
		]);
		expect(reasons[1].message).toContain("ENOENT");
		expect(reasons[2].message).toBe(`working directory does not exist: ${join(cwd, "missing/dir")}`);

		const after = await server.callPlan("async () => 6 * 7");
		expect(after.result.content[0].text).toBe("42");
		expect(server.child.exitCode).toBeNull();
	} finally {
		server.child.kill();
	}
});
