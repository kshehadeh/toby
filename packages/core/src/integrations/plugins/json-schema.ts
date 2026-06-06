import { z } from "zod";

type JsonSchema = Record<string, unknown>;

function readString(schema: JsonSchema, key: string): string | undefined {
	const value = schema[key];
	return typeof value === "string" ? value : undefined;
}

function readArray(schema: JsonSchema, key: string): unknown[] | undefined {
	const value = schema[key];
	return Array.isArray(value) ? value : undefined;
}

function schemaForProperty(schema: JsonSchema): z.ZodTypeAny {
	const type = readString(schema, "type");
	const description = readString(schema, "description");
	const enumValues = readArray(schema, "enum");

	let base: z.ZodTypeAny;
	if (enumValues?.every((v) => typeof v === "string")) {
		if (enumValues.length === 0) {
			base = z.string();
		} else {
			base = z.enum(enumValues as [string, ...string[]]);
		}
	} else {
		switch (type) {
			case "string":
				base = z.string();
				break;
			case "number":
			case "integer":
				base = z.number();
				break;
			case "boolean":
				base = z.boolean();
				break;
			case "array": {
				const items = schema.items;
				if (items && typeof items === "object" && !Array.isArray(items)) {
					base = z.array(schemaForProperty(items as JsonSchema));
				} else {
					base = z.array(z.unknown());
				}
				break;
			}
			case "object": {
				base = jsonSchemaToZod(schema);
				break;
			}
			default:
				base = z.unknown();
		}
	}

	if (description) {
		base = base.describe(description);
	}

	return base;
}

/**
 * Converts a JSON Schema object definition into a Zod schema (subset used by plugins).
 */
export function jsonSchemaToZod(
	schema: JsonSchema,
): z.ZodObject<z.ZodRawShape> {
	const properties = schema.properties;
	const required = readArray(schema, "required") ?? [];
	const requiredSet = new Set(
		required.filter((v): v is string => typeof v === "string"),
	);

	const shape: z.ZodRawShape = {};

	if (
		properties &&
		typeof properties === "object" &&
		!Array.isArray(properties)
	) {
		for (const [key, propSchema] of Object.entries(properties)) {
			if (
				!propSchema ||
				typeof propSchema !== "object" ||
				Array.isArray(propSchema)
			) {
				shape[key] = z.unknown().optional();
				continue;
			}
			let field = schemaForProperty(propSchema as JsonSchema);
			if (!requiredSet.has(key)) {
				field = field.optional();
			}
			shape[key] = field;
		}
	}

	return z.object(shape);
}
