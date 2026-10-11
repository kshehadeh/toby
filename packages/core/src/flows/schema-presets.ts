import { z } from "zod";
import type { FlowSchemaSpec } from "./document-types";

const markdownObjectSchema = z.object({
	markdown: z
		.string()
		.describe("User-facing markdown only — no chain-of-thought"),
});

/** Resolve a serializable schema spec to a Zod schema for the LLM Prompter. */
export function schemaFromSpec(spec: FlowSchemaSpec): z.ZodTypeAny {
	if (spec.kind === "markdown") {
		return markdownObjectSchema;
	}
	if (spec.kind === "object") {
		if (
			!spec.fields ||
			typeof spec.fields !== "object" ||
			Array.isArray(spec.fields)
		)
			throw new Error("Structured output needs named fields");
		const fields = Object.entries(spec.fields);
		if (fields.length === 0 || fields.length > 32)
			throw new Error("Structured output needs 1–32 fields");
		const shape: Record<string, z.ZodTypeAny> = {};
		for (const [name, field] of fields) {
			if (
				!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) ||
				["constructor", "prototype", "__proto__"].includes(name)
			)
				throw new Error(`Invalid structured output field "${name}"`);
			if (!field || !["string", "boolean", "number"].includes(field.type))
				throw new Error(`Unsupported type for output field "${name}"`);
			if (
				field.description !== undefined &&
				typeof field.description !== "string"
			)
				throw new Error(`Description for output field "${name}" must be text`);
			let schema: z.ZodTypeAny =
				field.type === "boolean"
					? z.boolean()
					: field.type === "number"
						? z.number()
						: z.string();
			if (field.description) schema = schema.describe(field.description);
			shape[name] = schema;
		}
		return z.object(shape).strict();
	}
	throw new Error(
		`Unsupported flow schema kind: ${JSON.stringify((spec as { kind: string }).kind)}`,
	);
}
