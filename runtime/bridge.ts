import type { MethodEnv } from "../core/types.ts";
import { findMethod } from "../providers/catalog.ts";
import { validateArguments } from "../schema/validation.ts";
import { ComputeTrace } from "./trace.ts";

export async function resolveProviderCall(
	providerName: string,
	methodName: string,
	rawArgs: Record<string, unknown>,
	env: MethodEnv,
	trace: ComputeTrace,
): Promise<string> {
	const found = findMethod(providerName, methodName);
	if (!found) {
		trace.record(providerName, methodName, rawArgs, true);
		return JSON.stringify({ ok: false, error: `Unknown Code Mode method ${providerName}.${methodName}.` });
	}
	const { method } = found;
	let args = rawArgs;
	try {
		if (method.prepare) args = method.prepare(rawArgs);
		const validationError = validateArguments(method, args);
		if (validationError) {
			trace.record(providerName, methodName, args as Record<string, unknown>, true);
			return JSON.stringify({ ok: false, error: validationError });
		}
		const result = await method.run(args as Record<string, unknown>, env);
		trace.record(providerName, methodName, args as Record<string, unknown>, result.isError === true);
		if (result.isError === true) {
			const text = (result.content ?? [])
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n");
			return JSON.stringify({ ok: false, error: text || "Compute call failed." });
		}
		return JSON.stringify({ ok: true, value: result });
	} catch (error) {
		trace.record(providerName, methodName, args as Record<string, unknown>, true);
		return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
	}
}
