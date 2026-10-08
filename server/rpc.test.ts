import { afterEach, beforeEach, expect, test } from "bun:test";
import { StdioRpc } from "./rpc.ts";

const originalWrite = process.stdout.write;
let sent: Array<{ id?: unknown; result?: unknown; error?: { message: string } }>;
beforeEach(() => {
	sent = [];
	process.stdout.write = ((chunk: string) => {
		sent.push(JSON.parse(chunk));
		return true;
	}) as typeof process.stdout.write;
});
afterEach(() => {
	process.stdout.write = originalWrite;
});

function feed(rpc: StdioRpc, message: Record<string, unknown>): void {
	(rpc as unknown as { handleLine(line: string): void }).handleLine(JSON.stringify({ jsonrpc: "2.0", ...message }));
}

test("failInFlight answers each pending request once, aborts it, and drops its late result", async () => {
	const rpc = new StdioRpc();
	let finish!: (value: unknown) => void;
	let aborted = false;
	rpc.onRequest("slow", (_params, signal) => {
		signal.addEventListener("abort", () => (aborted = true));
		return new Promise((resolve) => (finish = resolve));
	});
	feed(rpc, { id: 7, method: "slow" });

	rpc.failInFlight("compute internal error (uncaught exception): boom");
	expect(aborted).toBe(true);
	expect(sent).toEqual([{ jsonrpc: "2.0", id: 7, error: { code: -32603, message: "compute internal error (uncaught exception): boom" } }]);

	finish("late");
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(sent).toHaveLength(1);
});

test("requests that finish normally are unaffected", async () => {
	const rpc = new StdioRpc();
	rpc.onRequest("fast", async () => ({ ok: true }));
	feed(rpc, { id: 1, method: "fast" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(sent).toEqual([{ jsonrpc: "2.0", id: 1, result: { ok: true } }]);
	rpc.failInFlight("nothing pending");
	expect(sent).toHaveLength(1);
});
