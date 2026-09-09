import { describe, expect, test } from "bun:test";
import type { ProviderSpec } from "../core/types.ts";
import { buildDeclarations, schemaType } from "./declarations.ts";

const catalog: ProviderSpec[] = [
	{
		name: "sample-api",
		methods: [
			{
				name: "find-item",
				description: "Find */ an item\n safely.",
				schema: {
					type: "object",
					properties: {
						zeta: { type: "boolean" },
						"item-id": { type: ["string", "null"] },
					},
					required: ["item-id"],
					additionalProperties: false,
				},
				returns: "string[]",
				run: async () => ({ content: [], details: null }),
			},
		],
	},
];

describe("declaration generation", () => {
	test("converts unions, arrays, enums, and closed empty objects", () => {
		expect(schemaType({ anyOf: [{ type: "string" }, { type: "number" }] })).toBe("string | number");
		expect(schemaType({ type: "array", items: { enum: ["a", "b"] } })).toBe('Array<"a" | "b">');
		expect(schemaType({ type: "object", additionalProperties: false })).toBe("Record<string, never>");
	});

	test("emits deterministic names, fields, comments, and signatures", () => {
		expect(buildDeclarations(catalog)).toBe(
			'type ComputeImage = { type: "image"; data: string; mimeType: string };\n' +
				'type ComputeImageOutput = { text: string; images: ComputeImage[] };\n' +
				'type ComputeToolOutput = string | { text: string; details: unknown } | ComputeImageOutput;\n\n' +
				'type SampleApiFindItemInput = { "item-id": string | null; zeta?: boolean };\n\n' +
				'declare const sample-api: {\n' +
				'  /** Find * / an item safely. */\n' +
				'  find-item(input: SampleApiFindItemInput): Promise<string[]>;\n' +
				'};',
		);
	});
});
