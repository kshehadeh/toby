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
	throw new Error(
		`Unsupported flow schema kind: ${JSON.stringify((spec as { kind: string }).kind)}`,
	);
}
