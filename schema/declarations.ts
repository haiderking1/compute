import type { JsonSchemaObject, ProviderSpec } from "../core/types.ts";

function pascalIdentifier(value: string): string {
	let out = "";
	let upper = true;
	for (const character of value) {
		if (!/[a-zA-Z0-9]/.test(character)) {
			upper = true;
			continue;
		}
		out += upper ? character.toUpperCase() : character;
		upper = false;
	}
	return out || "Value";
}

function sanitizeComment(value: string): string {
	return value.replace(/\*\//g, "* /").split(/\s+/).filter(Boolean).join(" ");
}

function isIdentifierName(value: string): boolean {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function literalType(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value === null) return "null";
	return "unknown";
}

export function schemaType(schema: unknown, depth = 0): string {
	if (depth > 24) return "unknown";
	const s = (schema ?? {}) as JsonSchemaObject;

	if (Array.isArray(s.enum) && s.enum.length > 0) {
		return s.enum.map(literalType).join(" | ");
	}
	const alternatives = Array.isArray(s.oneOf) ? s.oneOf : Array.isArray(s.anyOf) ? s.anyOf : undefined;
	if (alternatives && alternatives.length > 0) {
		return alternatives.map((alternative) => schemaType(alternative, depth + 1)).join(" | ");
	}
	if (Array.isArray(s.type)) {
		return s.type.filter((kind) => typeof kind === "string").map((kind) => schemaKind(kind, s, depth + 1)).join(" | ");
	}
	if (typeof s.type === "string") return schemaKind(s.type, s, depth + 1);
	if (s.properties && typeof s.properties === "object") return objectType(s, depth + 1);
	return "unknown";
}

function schemaKind(kind: string, schema: JsonSchemaObject, depth: number): string {
	switch (kind) {
		case "object":
			return objectType(schema, depth);
		case "array": {
			const item = schema.items !== undefined ? schemaType(schema.items, depth) : "unknown";
			return `Array<${item}>`;
		}
		case "string":
			return "string";
		case "integer":
		case "number":
			return "number";
		case "boolean":
			return "boolean";
		case "null":
			return "null";
		default:
			return "unknown";
	}
}

function objectType(schema: JsonSchemaObject, depth: number): string {
	const properties = schema.properties ?? {};
	// Raid emits properties in sorted order (serde_json's BTreeMap) and required
	// names in sorted order (BTreeSet), so mirror that ordering.
	const names = Object.keys(properties).sort();
	const required = new Set(Array.isArray(schema.required) ? schema.required : []);
	if (names.length === 0) {
		return schema.additionalProperties === false ? "Record<string, never>" : "Record<string, unknown>";
	}
	const fields = names.map((name) => {
		const optional = required.has(name) ? "" : "?";
		const key = isIdentifierName(name) ? name : JSON.stringify(name);
		return `${key}${optional}: ${schemaType(properties[name], depth + 1)}`;
	});
	return `{ ${fields.join("; ")} }`;
}

function inputTypeName(provider: string, method: string): string {
	return `${pascalIdentifier(provider)}${pascalIdentifier(method)}Input`;
}

export function buildDeclarations(catalog: ProviderSpec[]): string {
	let out =
		'type ComputeImage = { type: "image"; data: string; mimeType: string };\n' +
		"type ComputeImageOutput = { text: string; images: ComputeImage[] };\n" +
		"type ComputeToolOutput = string | { text: string; details: unknown } | ComputeImageOutput;\n\n";

	for (const provider of catalog) {
		for (const method of provider.methods) {
			out += `type ${inputTypeName(provider.name, method.name)} = ${schemaType(method.schema)};\n`;
		}
		out += `\ndeclare const ${provider.name}: {\n`;
		for (const method of provider.methods) {
			out += `  /** ${sanitizeComment(method.description)} */\n`;
			out += `  ${method.name}(input: ${inputTypeName(provider.name, method.name)}): Promise<${method.returns}>;\n`;
		}
		out += "};\n\n";
	}
	return out.trimEnd();
}
