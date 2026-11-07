import { z } from "zod";
import {
	type TodoOperation,
	checklistSchema,
	dueSchema,
	idSchema,
	reminderSchema,
	todoFieldsSchema,
} from "./types";

const stateSchema = z
	.object({
		status: z.enum(["open", "completed", "skipped"]),
		at: z.string().datetime().nullable(),
		snapshot: todoFieldsSchema.optional(),
		closedDue: dueSchema.nullable().optional(),
		closedChecklist: z.array(checklistSchema).max(200).optional(),
		closedTags: z.array(idSchema).max(100).optional(),
		next: z
			.object({
				due: dueSchema,
				checklist: z.array(checklistSchema).max(200),
			})
			.strict()
			.nullable()
			.optional(),
	})
	.strict();
const fieldsSchema = z
	.record(z.string().max(240), z.unknown())
	.refine((fields) => Object.keys(fields).length <= 1000, "Too many fields");
const changeSchema = z
	.object({
		kind: z.enum(["todo", "occurrence", "list", "tag"]),
		id: idSchema,
		fields: fieldsSchema,
	})
	.strict()
	.superRefine((change, context) => {
		for (const [key, value] of Object.entries(change.fields)) {
			let schema: z.ZodType | undefined;
			if (change.kind === "list" || change.kind === "tag") {
				schema =
					key === "name"
						? z.string().trim().min(1).max(200)
						: key === "deleted"
							? z.boolean()
							: undefined;
			} else {
				if (Object.hasOwn(todoFieldsSchema.shape, key))
					schema =
						todoFieldsSchema.shape[key as keyof typeof todoFieldsSchema.shape];
				else if (
					key.startsWith("check:") &&
					idSchema.safeParse(key.slice(6)).success
				)
					schema = checklistSchema.nullable();
				else if (
					key.startsWith("reminder:") &&
					idSchema.safeParse(key.slice(9)).success
				)
					schema = reminderSchema.nullable();
				else if (change.kind === "todo") {
					if (key === "anchor") schema = dueSchema.nullable();
					else if (key === "deleted") schema = z.boolean();
					else if (key === "createdAt" || key === "updatedAt")
						schema = z.string().datetime();
					else if (
						key.startsWith("tag:") &&
						idSchema.safeParse(key.slice(4)).success
					)
						schema = z.boolean();
				} else {
					if (key === "due") schema = dueSchema.nullable();
					else if (key === "state") schema = stateSchema;
					else if (
						key.startsWith("reminder:") &&
						idSchema.safeParse(key.slice(9)).success
					)
						schema = reminderSchema.nullable();
				}
			}
			if (!schema?.safeParse(value).success)
				context.addIssue({
					code: "custom",
					message: `Invalid ${change.kind} field: ${key}`,
					path: ["fields", key],
				});
			if (
				value &&
				typeof value === "object" &&
				(key.startsWith("check:") || key.startsWith("reminder:"))
			) {
				const prefix = key.startsWith("check:") ? 6 : 9;
				if ((value as { id?: unknown }).id !== key.slice(prefix))
					context.addIssue({
						code: "custom",
						message: "Element ID does not match its field",
						path: ["fields", key],
					});
			}
		}
	});

export const todoOperationSchema = z
	.object({
		version: z.literal(1),
		id: idSchema,
		replica: idSchema,
		clock: z
			.number()
			.int()
			.min(1)
			.max(Number.MAX_SAFE_INTEGER - 1),
		at: z.string().datetime(),
		source: z.string().min(1).max(200),
		changes: z.array(changeSchema).min(1).max(20000),
	})
	.strict();

/** Validate the full authenticated operation before touching persistent state. */
export function parseTodoOperation(raw: unknown): TodoOperation {
	return todoOperationSchema.parse(raw);
}
