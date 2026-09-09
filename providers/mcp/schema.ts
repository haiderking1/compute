import { Type } from "typebox";
import type { JsonSchemaObject } from "../../core/types.ts";

/** JSON Schema -> TypeBox (ported from pi's exa-mcp extension). */
export function toTypeBox(schema: JsonSchemaObject | undefined): unknown {
	const s = schema ?? {};
	const opts = s.description ? { description: s.description } : {};

	if (Array.isArray(s.enum) && s.enum.length > 0) {
		const literals = s.enum.map((v) => Type.Literal(v as never));
		return literals.length === 1 ? literals[0] : Type.Union(literals);
	}
	const alternatives = Array.isArray(s.oneOf) ? s.oneOf : Array.isArray(s.anyOf) ? s.anyOf : undefined;
	if (alternatives && alternatives.length > 0) {
		return Type.Union(alternatives.map((a) => toTypeBox(a) as never), opts);
	}

	switch (s.type) {
		case "string":
			return Type.String(opts);
		case "integer":
		case "number":
			return Type.Number(opts);
		case "boolean":
			return Type.Boolean(opts);
		case "null":
			return Type.Null(opts);
		case "array":
			return Type.Array(toTypeBox(s.items) as never, opts);
		case "object": {
			const props: Record<string, unknown> = {};
			for (const [key, propSchema] of Object.entries(s.properties ?? {})) {
				const converted = toTypeBox(propSchema);
				props[key] = s.required?.includes(key) ? converted : (Type.Optional(converted as never) as never);
			}
			return Type.Object(props, opts);
		}
		default:
			return Type.Any(opts);
	}
}
