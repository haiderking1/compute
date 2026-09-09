interface ComputeCallTraceEntry {
	provider: string;
	method: string;
	path?: string;
	is_error: boolean;
}

export class ComputeTrace {
	private calls: ComputeCallTraceEntry[] = [];

	record(provider: string, method: string, args: Record<string, unknown>, isError: boolean): void {
		const entry: ComputeCallTraceEntry = { provider, method, is_error: isError };
		if (method === "read" || method === "edit" || method === "write") {
			const path = args.path;
			if (typeof path === "string") entry.path = path;
		}
		this.calls.push(entry);
	}

	details(): unknown {
		return this.calls.length > 0 ? { codeModeCalls: this.calls } : null;
	}
}
