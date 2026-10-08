import { createInterface } from "node:readline";

/** Newline-delimited JSON-RPC 2.0 over stdio, as MCP's stdio transport expects. */
export interface RpcRequest {
	jsonrpc: "2.0";
	id?: number | string;
	method: string;
	params?: Record<string, unknown>;
}

export type RequestHandler = (params: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
export type NotificationHandler = (params: Record<string, unknown>) => void;

export class StdioRpc {
	private readonly requests = new Map<string, RequestHandler>();
	private readonly notifications = new Map<string, NotificationHandler>();
	private readonly inFlight = new Map<number | string, AbortController>();

	onRequest(method: string, handler: RequestHandler): void {
		this.requests.set(method, handler);
	}

	onNotification(method: string, handler: NotificationHandler): void {
		this.notifications.set(method, handler);
	}

	/** Abort an in-flight request (MCP notifications/cancelled). */
	cancel(id: number | string): void {
		this.inFlight.get(id)?.abort();
	}

	/**
	 * Answer every in-flight request with an internal error and abort its work.
	 * Used for exceptions that escaped all handlers: the host gets the message
	 * instead of a dropped connection, and late results are discarded.
	 */
	failInFlight(message: string): void {
		for (const [id, controller] of this.inFlight) {
			this.inFlight.delete(id);
			controller.abort();
			this.send({ jsonrpc: "2.0", id, error: { code: -32603, message } });
		}
	}

	notify(method: string, params?: Record<string, unknown>): void {
		this.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
	}

	listen(): void {
		const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
		rl.on("line", (line) => this.handleLine(line));
		rl.on("close", () => {
			for (const controller of this.inFlight.values()) controller.abort();
			process.exit(0);
		});
	}

	private send(message: unknown): void {
		process.stdout.write(`${JSON.stringify(message)}\n`);
	}

	private handleLine(line: string): void {
		if (!line.trim()) return;
		let message: RpcRequest;
		try {
			message = JSON.parse(line) as RpcRequest;
		} catch {
			this.send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
			return;
		}
		const params = message.params ?? {};
		if (message.id === undefined) {
			this.notifications.get(message.method)?.(params);
			return;
		}
		const handler = this.requests.get(message.method);
		if (!handler) {
			this.send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
			return;
		}
		const id = message.id;
		const controller = new AbortController();
		this.inFlight.set(id, controller);
		// failInFlight may already have answered this id; never answer twice.
		const current = () => this.inFlight.get(id) === controller;
		handler(params, controller.signal)
			.then((result) => {
				if (current()) this.send({ jsonrpc: "2.0", id, result });
			})
			.catch((error: unknown) => {
				if (!current()) return;
				this.send({
					jsonrpc: "2.0",
					id,
					error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
				});
			})
			.finally(() => {
				if (current()) this.inFlight.delete(id);
			});
	}
}
