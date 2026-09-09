/**
 * Isolated compute worker for the pi `compute` extension.
 *
 * Executes a single JavaScript plan in a fresh child process. The plan is an
 * async arrow function that composes provider methods (`workspace.*`,
 * `system.*`, `raid.*`). Every provider call is bridged to the parent pi process
 * over a line-delimited JSON protocol on stdio, matching Raid's compute worker.
 *
 * The plan runs inside a `node:vm` context whose only globals are the provider
 * objects and a no-op `console`. It does not expose `process`, `require`,
 * `Buffer`, `fs`, `fetch`, or any other host capability, and a dynamic
 * `import()` is rejected by Node because no dynamic-import callback is
 * installed. The child process is the real isolation boundary.
 *
 * Raid runs its plan on an rquickjs runtime with a hard 64 MiB memory limit and
 * a 1 MiB stack limit. Node's `vm` cannot enforce either, so this worker
 * approximates the memory limit with a watchdog that samples the process heap
 * and fails the plan once it exceeds the budget; the process is additionally
 * started with `--max-old-space-size` as a hard cap.
 *
 * Protocol (line-delimited JSON on stdio):
 *   parent -> worker:
 *     { type: "start", code, providers: [{ name, methods }], cwd }
 *     { type: "call-result", id, envelope }
 *   worker -> parent:
 *     { type: "call", id, provider, method, args }
 *     { type: "complete", output }
 *     { type: "failed", error }
 *
 * `envelope` is a JSON string:
 *   { "ok": true,  "value": AgentToolResult }  |  { "ok": false, "error": string }
 */

import { createContext, runInContext } from "node:vm";
import readline from "node:readline";
import { ProviderCallError, formatPlanError } from "./runtime/errors.mjs";

const NOT_SERIALIZABLE = "__RAID_COMPUTE_NOT_SERIALIZABLE__";
/** Raid parity: rquickjs runtime memory limit. */
const MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Bridge back to the parent pi process
// ---------------------------------------------------------------------------

let nextId = 1;
const pending = new Map();

function write(message) {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Call a provider method in the parent and decode the result exactly as Raid's
 * worker does: a raw `codeModeValue`, `{ text, details }`, or a text string.
 * Throws when the call fails.
 */
async function invoke(provider, method, input) {
	const id = nextId++;
	const envelope = await new Promise((resolve) => {
		pending.set(id, resolve);
		write({ type: "call", id, provider, method, args: input ?? {} });
	});

	const parsed = JSON.parse(envelope);
	if (!parsed.ok) {
		throw new ProviderCallError(provider, method, parsed.error ?? "Compute call failed.");
	}

	const result = parsed.value;
	const content = Array.isArray(result?.content) ? result.content : [];
	const texts = content.filter((part) => part && part.type === "text").map((part) => part.text);
	const images = content.filter((part) => part && part.type === "image");
	const text = texts.join("\n");

	if (images.length > 0) {
		return { __raidToolResult: true, result, text, images };
	}
	if (result?.details && Object.prototype.hasOwnProperty.call(result.details, "codeModeValue")) {
		return result.details.codeModeValue;
	}
	if (result?.details !== null && result?.details !== undefined) {
		return { text, details: result.details };
	}
	return text;
}

// ---------------------------------------------------------------------------
// Sandbox setup
// ---------------------------------------------------------------------------

function buildSandbox(providers) {
	const sandbox = {
		console: {
			log() {},
			warn() {},
			error() {},
		},
		setTimeout,
		clearTimeout,
	};

	for (const provider of providers) {
		const methods = {};
		for (const method of provider.methods) {
			// Computed key: any tool name is a safe property, unlike Raid's
			// generated-source bootstrap which requires valid identifiers.
			methods[method] = (input) => invoke(provider.name, method, input);
		}
		Object.defineProperty(sandbox, provider.name, {
			value: Object.freeze(methods),
			writable: false,
			configurable: false,
			enumerable: true,
		});
	}

	return sandbox;
}

function wrappedSource(code) {
	// Built by concatenation, not a template literal, so a user plan containing
	// backticks or ${...} cannot corrupt the generated source.
	return (
		"(async () => {\n" +
		"  const __raidPlan = (\n" +
		code +
		"\n);\n" +
		'  if (typeof __raidPlan !== "function") throw new TypeError("compute code must be an async arrow function");\n' +
		"  const value = await __raidPlan();\n" +
		'  if (value === undefined) return "undefined";\n' +
		'  if (typeof value === "string") return value;\n' +
		"  try {\n" +
		"    const serialized = JSON.stringify(value, null, 2);\n" +
		'    if (serialized === undefined) throw new Error("' +
		NOT_SERIALIZABLE +
		'");\n' +
		"    return serialized;\n" +
		"  } catch (e) {\n" +
		'    if (e && e.message === "' +
		NOT_SERIALIZABLE +
		'") throw e;\n' +
		'    throw new Error("' +
		NOT_SERIALIZABLE +
		'");\n' +
		"  }\n" +
		"})()"
	);
}


async function runPlan(message) {
	// Raid parity: the rquickjs runtime enforces a hard memory limit. Node's vm
	// cannot, so sample the worker heap and fail the plan when it exceeds the
	// budget (the process is additionally capped by --max-old-space-size).
	let finished = false;
	const memoryTimer = setInterval(() => {
		if (finished) return;
		if (process.memoryUsage().heapUsed > MEMORY_LIMIT_BYTES) {
			finished = true;
			clearInterval(memoryTimer);
			write({
				type: "failed",
				error: `compute exceeded the ${Math.round(MEMORY_LIMIT_BYTES / (1024 * 1024))} MiB worker memory budget`,
			});
		}
	}, 200);

	try {
		const sandbox = buildSandbox(message.providers);
		const context = createContext(sandbox);
		const promise = runInContext(wrappedSource(message.code), context, {
			filename: "compute-plan.js",
		});
		const output = await promise;
		if (!finished) {
			finished = true;
			clearInterval(memoryTimer);
			write({ type: "complete", output });
		}
	} catch (error) {
		if (!finished) {
			finished = true;
			clearInterval(memoryTimer);
			write({ type: "failed", error: formatPlanError(error) });
		}
	} finally {
		finished = true;
		clearInterval(memoryTimer);
	}
}

// ---------------------------------------------------------------------------
// Worker entrypoint. The stdin reader must keep running while the plan awaits
// so that provider call results are processed.
// ---------------------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

(async () => {
	let started = false;
	for await (const line of rl) {
		if (!line) continue;
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			continue;
		}
		if (message.type === "call-result") {
			const resolve = pending.get(message.id);
			if (resolve) {
				pending.delete(message.id);
				resolve(message.envelope);
			}
		} else if (message.type === "start" && !started) {
			started = true;
			void runPlan(message);
		}
	}
})();
