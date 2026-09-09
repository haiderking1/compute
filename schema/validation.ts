import { Check, Errors } from "typebox/value";
import type { MethodSpec } from "../core/types.ts";

export function validateArguments(method: MethodSpec, args: unknown): string | null {
	if (Check(method.schema as never, args)) return null;
	const errors = Errors(method.schema as never, args);
	const lines = (Array.isArray(errors) ? errors : []).map(
		(error) => `  - ${(error as { instancePath?: string }).instancePath || "/"}: ${(error as { message?: string }).message}`,
	);
	const received = (() => {
		try {
			return JSON.stringify(args, null, 2) ?? "{}";
		} catch {
			return "{}";
		}
	})();
	return `Validation failed for tool "${method.name}":\n${lines.join("\n")}\n\nReceived arguments:\n${received}`;
}
