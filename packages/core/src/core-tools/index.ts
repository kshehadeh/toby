import { type Tool, tool, zodSchema } from "ai";
import { z } from "zod";
import * as todos from "../todos/service";
import {
	type MutationContext,
	TodoError,
	checklistSchema,
	idSchema,
	reminderSchema,
} from "../todos/types";

export type CoreToolDefinition = {
	id: string;
	chatName: string;
	title: string;
	description: string;
	readOnly: boolean;
	schema: z.ZodType;
	execute: (input: unknown, context: MutationContext) => unknown;
};
const definitions: CoreToolDefinition[] = [];
const mutationEnvelopeSchema = z.object({
	idempotencyKey: z.string().min(1).max(500).optional(),
	expectedRevision: z.string().optional(),
	dryRun: z.boolean().optional(),
});
function define<S extends z.AnyZodObject>(
	id: string,
	chatName: string,
	title: string,
	readOnly: boolean,
	schema: S,
	execute: (input: z.infer<S>, context: MutationContext) => unknown,
	detail = "",
) {
	definitions.push({
		id: `todos.${id}`,
		chatName,
		title,
		readOnly,
		schema: readOnly ? schema : schema.extend(mutationEnvelopeSchema.shape),
		description: `${title} in Toby's internal todo system. ${detail} Use by default for todo requests unless another provider is explicitly requested or clearly referenced.`,
		execute: (input, ctx) => execute(schema.parse(input), ctx),
	});
}
const target = z.object({ id: idSchema });
define(
	"list",
	"listTobyTodos",
	"Find todos",
	true,
	todos.listTodosSchema,
	(input) => todos.listTodos(input),
);
define(
	"get",
	"getTobyTodo",
	"Get todo",
	true,
	target.extend({ sequence: z.number().int().min(0).optional() }),
	(input) => todos.getTodo(input.id, input.sequence),
);
define(
	"create",
	"createTobyTodo",
	"Create todo",
	false,
	todos.createTodoSchema,
	todos.createTodo,
	"When the user asks to be reminded, set remind: true; it schedules a macOS notification at the due date/time and requires a due date with a time.",
);
define(
	"update",
	"updateTobyTodo",
	"Update todo",
	false,
	target.extend({ changes: todos.updateTodoSchema }),
	(input, ctx) => todos.updateTodo(input.id, input.changes, ctx),
	"Use scope=series for future recurrence; omitted fields are unchanged and null clears an optional field.",
);
for (const action of ["complete", "skip", "reopen"] as const) {
	define(
		action,
		`${action}TobyTodo`,
		`${action[0].toUpperCase()}${action.slice(1)} todo`,
		false,
		target.extend({
			sequence: z.number().int().min(0),
			allowIncompleteChecklist: z.boolean().default(false),
		}),
		(input, ctx) => todos.transitionTodo(input.id, action, input, ctx),
		"Always use the occurrence sequence returned by get/list so retries never advance a later occurrence.",
	);
}
for (const restore of [false, true]) {
	define(
		restore ? "restore" : "delete",
		restore ? "restoreTobyTodo" : "deleteTobyTodo",
		restore ? "Restore deleted todo" : "Delete todo",
		false,
		target,
		(input, ctx) => todos.deleteTodo(input.id, restore, ctx),
	);
}
define(
	"setTag",
	"setTobyTodoTag",
	"Assign or remove todo tag",
	false,
	target.extend({ tagId: idSchema, enabled: z.boolean() }),
	(input, ctx) => todos.setTodoTag(input.id, input.tagId, input.enabled, ctx),
);
define(
	"setChecklistItem",
	"setTobyTodoChecklistItem",
	"Set checklist item",
	false,
	target.extend({ item: checklistSchema, remove: z.boolean().default(false) }),
	(input, ctx) =>
		todos.setChecklistItem(input.id, input.item, input.remove, ctx),
);
define(
	"setReminder",
	"setTobyTodoReminder",
	"Set or snooze todo reminder",
	false,
	target.extend({
		reminder: reminderSchema,
		remove: z.boolean().default(false),
	}),
	(input, ctx) =>
		todos.setReminder(input.id, input.reminder, input.remove, ctx),
	'Reminder definitions sync. Snoozing changes snoozedUntil, never the due date. Use id "due" with offsetMinutes 0 to remind at the due time; a date-only todo needs an absolute "at" time.',
);
for (const kind of ["list", "tag"] as const) {
	const plural = kind === "list" ? "Lists" : "Tags";
	define(
		`${kind}s`,
		`listTobyTodo${plural}`,
		`List todo ${kind}s`,
		true,
		z.object({}),
		() => ({
			[kind === "list" ? "lists" : "tags"]: todos.listOrganization(kind),
		}),
	);
	define(
		`save${plural}`,
		`saveTobyTodo${kind === "list" ? "List" : "Tag"}`,
		`Create, rename, or remove todo ${kind}`,
		false,
		z.object({
			id: idSchema.optional(),
			name: z.string().trim().min(1).max(200).optional(),
			remove: z.boolean().default(false),
		}),
		(input, ctx) => todos.saveOrganization(kind, input, ctx),
	);
}
define(
	"history",
	"getTobyTodoHistory",
	"Read todo history",
	true,
	target,
	(input) => ({ entries: todos.todoHistoryEntries(input.id) }),
);
define(
	"restoreField",
	"restoreTobyTodoField",
	"Restore todo field from history",
	false,
	target.extend({ operationId: idSchema, field: z.string().min(1) }),
	(input, ctx) => {
		const operation = todos
			.todoHistory(input.id)
			.find((op) => op.id === input.operationId);
		const current = todos.getTodo(input.id);
		const change = operation?.changes.find(
			(c) =>
				Object.hasOwn(c.fields, input.field) &&
				((c.kind === "todo" && c.id === input.id) ||
					(c.kind === "occurrence" && c.id === current.occurrenceId)),
		);
		if (!change)
			throw new TodoError(
				"not_found",
				"This historical value was not found on the current todo.",
				404,
			);
		const field =
			change.kind === "todo" && input.field === "anchor" ? "due" : input.field;
		if (!todos.restorableTodoFields.has(field))
			throw new TodoError("not_restorable", "This field cannot be restored.");
		return todos.updateTodo(
			input.id,
			{
				[field]: change.fields[input.field],
				scope: change.kind === "todo" ? "series" : "occurrence",
			},
			ctx,
		);
	},
);
define(
	"summary",
	"getTobyTodosSummary",
	"Summarize open todos",
	true,
	z.object({}),
	() => todos.todoSummary(),
);

export function listCoreTools(): readonly CoreToolDefinition[] {
	return definitions;
}
export function getCoreTool(id: string): CoreToolDefinition | undefined {
	return definitions.find((definition) => definition.id === id);
}
export function executeCoreTool(
	id: string,
	raw: unknown,
	context: MutationContext = {},
) {
	const definition = getCoreTool(id);
	if (!definition)
		throw new TodoError("unknown_tool", `Unknown built-in tool: ${id}`, 404);
	const envelope = mutationEnvelopeSchema.passthrough().parse(raw);
	const { idempotencyKey, expectedRevision, dryRun, ...input } = envelope;
	return definition.execute(input, {
		...context,
		idempotencyKey: idempotencyKey ?? context.idempotencyKey,
		expectedRevision: expectedRevision ?? context.expectedRevision,
		dryRun: context.dryRun || dryRun,
	});
}
export function createCoreChatTools(ctx: {
	dryRun: boolean;
	appliedActions: string[];
}): Record<string, Tool> {
	return Object.fromEntries(
		definitions.map((definition) => [
			definition.chatName,
			tool({
				description: definition.description,
				inputSchema: definition.schema,
				execute: async (input) => {
					try {
						const result = executeCoreTool(definition.id, input, {
							source: "chat",
							dryRun: ctx.dryRun,
						});
						if (
							!definition.readOnly &&
							!ctx.dryRun &&
							!(input as { dryRun?: boolean }).dryRun
						)
							ctx.appliedActions.push(definition.title);
						return { ok: true, provider: "toby", result };
					} catch (error) {
						return {
							ok: false,
							code: error instanceof TodoError ? error.code : "invalid_input",
							error: error instanceof Error ? error.message : String(error),
						};
					}
				},
			}),
		]),
	);
}
export async function coreFlowCatalog() {
	return Promise.all(
		definitions.map(async (definition) => ({
			coreTool: definition.id,
			moduleName: "tobyTodos",
			toolName: definition.id,
			displayName: definition.title,
			description: definition.description,
			readOnly: definition.readOnly,
			inputSchema: (await zodSchema(definition.schema).jsonSchema) as {
				readonly type?: string;
				readonly properties?: Readonly<Record<string, unknown>>;
				readonly required?: readonly string[];
			},
		})),
	);
}

export const TODO_POLICY = `
## Toby todos
Unqualified requests to create, list, update, complete, or remove todos/tasks use Toby's internal todo tools by default, even when an external task provider is configured.
Use an external provider only when the user explicitly requests it or clearly refers to an external item from context. Preserve that item's provider identity on follow-ups; do not copy between providers.
Find current records before editing, use stable IDs and occurrence sequence, and askUser when multiple matches are possible. Do not guess identifiers or claim a change before a tool succeeds.
Lists, tags, dates, and projects are separate concepts. When the user asks to be reminded, set remind: true on createTobyTodo (or call setTobyTodoReminder with offsetMinutes 0); never claim a reminder exists without one. Ask for an explicit reminder time for date-only todos. Creating a todo records intent; it does not authorize executing the task.
`;
