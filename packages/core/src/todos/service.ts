import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ensureTobyDir, resolveTobyDir } from "../config/index";
import { dueInstant, isOverdue, localDateTime, nextDue } from "./recurrence";
import {
	entities,
	entity,
	hash,
	mutate,
	operationStamp,
	operations,
	revision,
	values,
} from "./store";
import {
	type Change,
	type ChecklistItem,
	type Due,
	type MutationContext,
	type OccurrenceState,
	type Reminder,
	type Todo,
	TodoError,
	checklistSchema,
	dueSchema,
	idSchema,
	recurrenceSchema,
	reminderSchema,
	todoFieldsSchema,
} from "./types";

export const occurrenceId = (id: string, sequence: number) =>
	`${id}:${sequence}`;

/** Kept outside SQLite so restoring another Mac's database never clones its identity. */
export function todoReplica(): string {
	ensureTobyDir();
	const file = path.join(resolveTobyDir(), "todo-replica");
	if (!fs.existsSync(file)) {
		try {
			fs.writeFileSync(file, randomUUID(), { mode: 0o600, flag: "wx" });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
	const id = fs.readFileSync(file, "utf8").trim();
	idSchema.parse(id);
	return id;
}

function requireEntity(kind: "todo" | "list" | "tag", id: string) {
	const record = entity(kind, idSchema.parse(id));
	if (!record || (kind === "todo" && !record.fields.createdAt))
		throw new TodoError(
			"not_found",
			`${kind} not found or still downloading.`,
			404,
		);
	return record;
}
function checkRevision(todo: Todo, ctx: MutationContext) {
	if (ctx.expectedRevision && ctx.expectedRevision !== todo.revision)
		throw new TodoError(
			"revision_conflict",
			"This todo changed. Reload it before saving.",
			409,
		);
}
function dictionary<T>(fields: Record<string, unknown>, prefix: string): T[] {
	return Object.entries(fields)
		.filter(([key, value]) => key.startsWith(prefix) && value !== null)
		.map(([, value]) => value as T);
}
type Lifecycle = OccurrenceState & {
	next?: { due: Due; checklist: ChecklistItem[] } | null;
	closedDue?: Due | null;
	closedChecklist?: ChecklistItem[];
	closedTags?: string[];
};

export function getTodo(id: string, sequence?: number): Todo {
	const record = requireEntity("todo", id);
	const fields = values(record);
	let seq = 0;
	let due = (fields.anchor ?? null) as Due | null;
	let baseChecklist: ChecklistItem[] = dictionary<ChecklistItem>(
		fields,
		"check:",
	).map((item) => ({ ...item, checked: false }));
	let occurrenceFields: Record<string, unknown> = {};
	let state: Lifecycle = { status: "open", at: null };
	let occurrenceRevision = "";
	let occurrenceStamps: Record<string, { stamp: string }> = {};
	for (;;) {
		const occurrence = entity("occurrence", occurrenceId(id, seq));
		occurrenceFields = occurrence ? values(occurrence) : {};
		if (Object.hasOwn(occurrenceFields, "due"))
			due = occurrenceFields.due as Due | null;
		state = (occurrenceFields.state ?? {
			status: "open",
			at: null,
		}) as Lifecycle;
		occurrenceRevision = occurrence ? revision(occurrence) : "";
		occurrenceStamps = occurrence?.fields ?? {};
		if (seq === sequence || state.status === "open" || !state.next) break;
		due = state.next.due;
		baseChecklist = state.next.checklist;
		seq++;
		if (seq > 100000)
			throw new TodoError(
				"invalid_history",
				"Occurrence history is too large.",
			);
	}
	if (sequence !== undefined && seq !== sequence)
		throw new TodoError(
			"occurrence_not_found",
			"Occurrence is not active in this series.",
			404,
		);
	const items = new Map(baseChecklist.map((item) => [item.id, item]));
	for (const [key, value] of Object.entries(occurrenceFields)) {
		if (!key.startsWith("check:")) continue;
		if (value === null) items.delete(key.slice(6));
		else items.set(key.slice(6), value as ChecklistItem);
	}
	const reminderItems = new Map(
		dictionary<Reminder>(fields, "reminder:").map((reminder) => [
			reminder.id,
			reminder,
		]),
	);
	for (const [key, value] of Object.entries(occurrenceFields)) {
		if (!key.startsWith("reminder:")) continue;
		if (value === null) reminderItems.delete(key.slice(9));
		else reminderItems.set(key.slice(9), value as Reminder);
	}
	const reminders = [...reminderItems.values()];
	const tags = Object.entries(fields)
		.filter(
			([key, value]) =>
				key.startsWith("tag:") &&
				value === true &&
				!values(
					entity("tag", key.slice(4)) ?? {
						kind: "tag",
						id: key.slice(4),
						fields: {},
					},
				).deleted,
		)
		.map(([key]) => key.slice(4));
	const closed = state.status !== "open";
	const overrides = fieldsDataOverrides(occurrenceFields);
	for (const key of Object.keys(overrides)) {
		const definitionStamp = record.fields[key]?.stamp;
		const occurrenceStamp = occurrenceStamps[key]?.stamp;
		if (definitionStamp && occurrenceStamp && definitionStamp > occurrenceStamp)
			delete overrides[key];
	}
	const parsedFields = todoFieldsSchema.parse(
		closed && state.snapshot
			? { ...state.snapshot }
			: {
					...fieldsData(fields),
					...overrides,
				},
	);
	if (
		parsedFields.listId !== "inbox" &&
		entity("list", parsedFields.listId)?.fields.deleted?.value === true
	)
		parsedFields.listId = "inbox";
	return {
		...parsedFields,
		id,
		revision: hash([
			revision(record),
			occurrenceRevision,
			seq,
			due,
			baseChecklist,
		]),
		createdAt: String(fields.createdAt),
		updatedAt: String(fields.updatedAt),
		deleted: fields.deleted === true,
		occurrenceId: occurrenceId(id, seq),
		sequence: seq,
		due:
			closed && Object.hasOwn(state, "closedDue")
				? (state.closedDue ?? null)
				: due,
		state,
		tags: closed ? (state.closedTags ?? tags) : tags,
		checklist:
			closed && state.closedChecklist
				? state.closedChecklist
				: [...items.values()].sort(
						(a, b) => a.order - b.order || a.id.localeCompare(b.id),
					),
		reminders,
	};
}

function fieldsData(fields: Record<string, unknown>) {
	return Object.fromEntries(
		Object.keys(todoFieldsSchema.shape).map((key) => [key, fields[key]]),
	);
}
function fieldsDataOverrides(fields: Record<string, unknown>) {
	return Object.fromEntries(
		Object.keys(todoFieldsSchema.shape)
			.filter((key) => Object.hasOwn(fields, key))
			.map((key) => [key, fields[key]]),
	);
}

export const listTodosSchema = z
	.object({
		query: z.string().max(1000).optional(),
		status: z.enum(["open", "completed", "all", "deleted"]).default("open"),
		listId: idSchema.optional(),
		projectId: idSchema.optional(),
		tagId: idSchema.optional(),
		priority: z.enum(["none", "low", "medium", "high"]).optional(),
		dueFrom: z.string().optional(),
		dueTo: z.string().optional(),
		limit: z.number().int().min(1).max(200).default(50),
		offset: z.number().int().min(0).default(0),
	})
	.strict();
export function listTodos(raw: unknown = {}) {
	const filter = listTodosSchema.parse(raw);
	let todos = entities("todo").flatMap((record) => {
		// Immutable batches may arrive out of order. Keep partial records in the
		// journal, but do not expose them until their create operation arrives.
		if (!record.fields.createdAt) return [];
		const current = getTodo(record.id);
		if (filter.status !== "completed") return [current];
		const completed: Todo[] = [];
		for (let seq = 0; seq <= current.sequence; seq++) {
			const item = getTodo(record.id, seq);
			if (item.state.status === "completed") completed.push(item);
		}
		return completed;
	});
	todos = todos.filter((todo) => {
		if ((filter.status === "deleted") !== todo.deleted) return false;
		if (filter.status === "open" && todo.state.status !== "open") return false;
		if (filter.listId && todo.listId !== filter.listId) return false;
		if (filter.projectId && todo.projectId !== filter.projectId) return false;
		if (filter.tagId && !todo.tags.includes(filter.tagId)) return false;
		if (filter.priority && todo.priority !== filter.priority) return false;
		if (filter.dueFrom && (!todo.due || todo.due.date < filter.dueFrom))
			return false;
		if (filter.dueTo && (!todo.due || todo.due.date > filter.dueTo))
			return false;
		const needle = filter.query?.toLowerCase();
		return (
			!needle ||
			`${todo.title}\n${todo.description}`.toLowerCase().includes(needle)
		);
	});
	todos.sort(
		(a, b) =>
			(a.due?.date ?? "9999").localeCompare(b.due?.date ?? "9999") ||
			a.id.localeCompare(b.id),
	);
	return {
		todos: todos.slice(filter.offset, filter.offset + filter.limit),
		total: todos.length,
	};
}

export const createTodoSchema = todoFieldsSchema.extend({
	due: dueSchema.nullable().default(null),
	tags: z.array(idSchema).max(100).default([]),
	checklist: z.array(z.string().trim().min(1).max(2000)).max(200).default([]),
	remind: z.boolean().default(false),
});
export const updateTodoSchema = todoFieldsSchema.partial().extend({
	due: dueSchema.nullable().optional(),
	scope: z.enum(["occurrence", "series"]).default("occurrence"),
});

function transact(
	action: string,
	input: unknown,
	ctx: MutationContext,
	build: () => { changes: Change[]; result: () => unknown },
) {
	return mutate({
		action,
		input,
		source: ctx.source,
		now: ctx.now ?? new Date().toISOString(),
		replica: todoReplica(),
		key: ctx.idempotencyKey,
		dryRun: ctx.dryRun,
		build: () => {
			const built = build();
			const ids = new Set(
				built.changes.flatMap((change) =>
					change.kind === "todo"
						? [change.id]
						: change.kind === "occurrence"
							? [change.id.slice(0, change.id.lastIndexOf(":"))]
							: [],
				),
			);
			for (const id of ids) {
				const definition = built.changes.find(
					(change) => change.kind === "todo" && change.id === id,
				);
				if (definition)
					definition.fields.updatedAt = ctx.now ?? new Date().toISOString();
				else
					built.changes.push({
						kind: "todo",
						id,
						fields: { updatedAt: ctx.now ?? new Date().toISOString() },
					});
			}
			return built;
		},
	});
}
function namedAvailable(kind: "list" | "tag", id: string) {
	if (kind === "list" && id === "inbox") return;
	if (values(requireEntity(kind, id)).deleted)
		throw new TodoError("deleted", `${kind} was deleted.`);
}
function editable(id: string, ctx: MutationContext, sequence?: number): Todo {
	const todo = getTodo(id, sequence);
	checkRevision(todo, ctx);
	if (todo.deleted)
		throw new TodoError("deleted", "Restore this todo before editing.", 409);
	return todo;
}

export function createTodo(raw: unknown, ctx: MutationContext = {}) {
	const input = createTodoSchema.parse(raw);
	if (input.recurrence && !input.due)
		throw new TodoError(
			"due_required",
			"A repeating todo needs an initial due date.",
		);
	if (input.remind && !input.due?.time)
		throw new TodoError(
			"time_required",
			"A reminder needs a due date with a time. Ask for a time first.",
		);
	return transact("create", input, ctx, () => {
		namedAvailable("list", input.listId);
		for (const tag of input.tags) namedAvailable("tag", tag);
		const id = randomUUID();
		const now = ctx.now ?? new Date().toISOString();
		const fields: Record<string, unknown> = {
			...todoFieldsSchema.parse(fieldsData(input)),
			anchor: input.due,
			deleted: false,
			createdAt: now,
			updatedAt: now,
		};
		for (const tag of input.tags) {
			fields[`tag:${tag}`] = true;
		}
		for (const [order, text] of input.checklist.entries()) {
			const key = randomUUID();
			fields[`check:${key}`] = { id: key, text, order, checked: false };
		}
		if (input.remind)
			fields["reminder:due"] = {
				id: "due",
				at: null,
				offsetMinutes: 0,
				snoozedUntil: null,
			};
		return {
			changes: [{ kind: "todo", id, fields }],
			result: () => getTodo(id),
		};
	});
}
export function updateTodo(
	id: string,
	raw: unknown,
	ctx: MutationContext = {},
) {
	const input = updateTodoSchema.parse(raw);
	return transact("update", { id, ...input }, ctx, () => {
		const todo = editable(id, ctx);
		if (input.listId) namedAvailable("list", input.listId);
		if (input.recurrence && !(input.due ?? todo.due))
			throw new TodoError("due_required", "A repeating todo needs a due date.");
		if (
			input.due === null &&
			(input.recurrence === undefined ? todo.recurrence : input.recurrence)
		)
			throw new TodoError(
				"due_required",
				"Stop repeating before clearing the due date.",
			);
		const fields: Record<string, unknown> = {
			updatedAt: ctx.now ?? new Date().toISOString(),
		};
		const overrides: Record<string, unknown> = {};
		for (const key of Object.keys(todoFieldsSchema.shape)) {
			if (!Object.hasOwn(input, key)) continue;
			const target =
				input.scope === "occurrence" && key !== "recurrence"
					? overrides
					: fields;
			target[key] = input[key as keyof typeof input];
		}
		if (input.scope === "series" && Object.hasOwn(input, "due"))
			fields.anchor = input.due;
		const changes: Change[] = [{ kind: "todo", id, fields }];
		if (Object.hasOwn(input, "due")) overrides.due = input.due;
		if (Object.keys(overrides).length)
			changes.push({
				kind: "occurrence",
				id: todo.occurrenceId,
				fields: overrides,
			});
		return { changes, result: () => getTodo(id) };
	});
}

export function transitionTodo(
	id: string,
	action: "complete" | "skip" | "reopen",
	params: { sequence?: number; allowIncompleteChecklist?: boolean } = {},
	ctx: MutationContext = {},
) {
	return transact(action, { id, ...params }, ctx, () => {
		const todo = editable(id, ctx, params.sequence);
		let state: Lifecycle;
		if (action === "reopen") {
			const current = getTodo(id);
			if (todo.state.status === "open")
				throw new TodoError(
					"already_open",
					"This occurrence is already open.",
					409,
				);
			if (
				current.sequence > todo.sequence + 1 ||
				(current.sequence === todo.sequence + 1 &&
					entity("occurrence", current.occurrenceId))
			)
				throw new TodoError(
					"later_work",
					"Later occurrences have changed. Their history cannot be rewritten.",
					409,
				);
			state = { status: "open", at: null };
		} else {
			if (todo.state.status !== "open")
				throw new TodoError(
					"already_closed",
					"This occurrence is already closed.",
					409,
				);
			if (action === "skip" && !todo.recurrence)
				throw new TodoError(
					"not_recurring",
					"Only repeating todos can be skipped.",
				);
			if (
				action === "complete" &&
				!params.allowIncompleteChecklist &&
				todo.checklist.some((item) => !item.checked)
			)
				throw new TodoError(
					"incomplete_checklist",
					"Acknowledge unfinished checklist items before completing.",
					409,
				);
			const at = ctx.now ?? new Date().toISOString();
			const anchor = values(requireEntity("todo", id)).anchor as Due | null;
			const next =
				todo.recurrence && todo.due && anchor
					? nextDue(anchor, todo.due, todo.recurrence, at)
					: null;
			state = {
				status: action === "complete" ? "completed" : "skipped",
				at,
				snapshot: todoFieldsSchema.parse(fieldsData({ ...todo })),
				closedDue: todo.due,
				closedChecklist: todo.checklist,
				closedTags: todo.tags,
				next: next
					? {
							due: next,
							checklist: dictionary<ChecklistItem>(
								values(requireEntity("todo", id)),
								"check:",
							).map((item) => ({ ...item, checked: false })),
						}
					: null,
			};
		}
		return {
			changes: [
				{ kind: "occurrence", id: todo.occurrenceId, fields: { state } },
			],
			result: () => ({
				occurrence: getTodo(id, todo.sequence),
				todo: getTodo(id),
			}),
		};
	});
}
export function deleteTodo(
	id: string,
	restore = false,
	ctx: MutationContext = {},
) {
	return transact(restore ? "restore" : "delete", { id }, ctx, () => {
		const todo = getTodo(id);
		checkRevision(todo, ctx);
		return {
			changes: [{ kind: "todo", id, fields: { deleted: !restore } }],
			result: () => getTodo(id),
		};
	});
}
export function setTodoTag(
	id: string,
	tagId: string,
	enabled: boolean,
	ctx: MutationContext = {},
) {
	idSchema.parse(tagId);
	return transact("tag", { id, tagId, enabled }, ctx, () => {
		editable(id, ctx);
		if (enabled) namedAvailable("tag", tagId);
		return {
			changes: [{ kind: "todo", id, fields: { [`tag:${tagId}`]: enabled } }],
			result: () => getTodo(id),
		};
	});
}
export function setChecklistItem(
	id: string,
	raw: unknown,
	remove = false,
	ctx: MutationContext = {},
) {
	const item = checklistSchema.parse(raw);
	return transact("checklist", { id, item, remove }, ctx, () => {
		const todo = editable(id, ctx);
		const template = { ...item, checked: false };
		return {
			changes: [
				{
					kind: "occurrence",
					id: todo.occurrenceId,
					fields: { [`check:${item.id}`]: remove ? null : item },
				},
				{
					kind: "todo",
					id,
					fields: { [`check:${item.id}`]: remove ? null : template },
				},
			],
			result: () => getTodo(id),
		};
	});
}
export function setReminder(
	id: string,
	raw: unknown,
	remove = false,
	ctx: MutationContext = {},
) {
	const reminder = reminderSchema.parse(raw);
	return transact("reminder", { id, reminder, remove }, ctx, () => {
		const todo = editable(id, ctx);
		if (!remove && reminder.offsetMinutes !== null && !todo.due?.time)
			throw new TodoError(
				"time_required",
				"A date-only todo needs an explicit reminder time.",
			);
		return {
			changes: [
				{
					kind: "occurrence",
					id: todo.occurrenceId,
					fields: { [`reminder:${reminder.id}`]: remove ? null : reminder },
				},
				{
					kind: "todo",
					id,
					fields: {
						[`reminder:${reminder.id}`]:
							!remove && reminder.offsetMinutes !== null
								? { ...reminder, snoozedUntil: null }
								: null,
					},
				},
			],
			result: () => getTodo(id),
		};
	});
}
export function listOrganization(kind: "list" | "tag") {
	const rows = entities(kind)
		.filter(
			(record) =>
				!values(record).deleted && typeof values(record).name === "string",
		)
		.map((record) => ({ id: record.id, ...values(record) }));
	return kind === "list" ? [{ id: "inbox", name: "Inbox" }, ...rows] : rows;
}
export function saveOrganization(
	kind: "list" | "tag",
	params: { id?: string; name?: string; remove?: boolean },
	ctx: MutationContext = {},
) {
	const input = z
		.object({
			id: idSchema.optional(),
			name: z.string().trim().min(1).max(200).optional(),
			remove: z.boolean().optional(),
		})
		.strict()
		.parse(params);
	if (input.id === "inbox")
		throw new TodoError("protected", "Inbox cannot be renamed or removed.");
	if (!input.name && !input.remove)
		throw new TodoError("name_required", "A name is required.");
	return transact(`save_${kind}`, input, ctx, () => {
		const id = input.id ?? randomUUID();
		if (input.id) requireEntity(kind, id);
		const changes: Change[] = [
			{
				kind,
				id,
				fields: {
					...(input.name ? { name: input.name } : {}),
					deleted: input.remove ?? false,
				},
			},
		];
		// Membership is resolved against tombstones when reading. A deletion
		// stays bounded regardless of how many todos reference the list or tag.
		return {
			changes,
			result: () => ({ id, ...values(requireEntity(kind, id)) }),
		};
	});
}
export function todoHistory(id: string) {
	requireEntity("todo", id);
	return operations().filter((op) =>
		op.changes.some(
			(change) =>
				(change.kind === "todo" && change.id === id) ||
				(change.kind === "occurrence" && change.id.startsWith(`${id}:`)),
		),
	);
}

export const restorableTodoFields: ReadonlySet<string> = new Set([
	...Object.keys(todoFieldsSchema.shape),
	"due",
]);
/** Flattened field edits, newest first. Superseded values remain restorable. */
export function todoHistoryEntries(id: string) {
	const record = requireEntity("todo", id);
	const current = getTodo(id);
	const occurrence = entity("occurrence", current.occurrenceId);
	const entries = todoHistory(id).flatMap((op) => {
		const stamp = operationStamp(op);
		return op.changes.flatMap((change) => {
			const target =
				change.kind === "todo"
					? record
					: change.id === current.occurrenceId
						? occurrence
						: null;
			return Object.entries(change.fields)
				.filter(([field]) => field !== "updatedAt")
				.map(([field, value]) => ({
					operationId: op.id,
					at: op.at,
					source: op.source,
					replica: op.replica,
					kind: change.kind,
					entityId: change.id,
					field,
					value,
					current: target?.fields[field]?.stamp === stamp,
					restorable:
						restorableTodoFields.has(field === "anchor" ? "due" : field) &&
						target !== null &&
						target?.fields[field]?.stamp !== stamp,
				}));
		});
	});
	return entries.reverse();
}

/** Only a local project deletion clears links; unresolved remote IDs survive. */
export function unlinkProjectTodos(projectId: string): void {
	for (const record of entities("todo")) {
		if (!record.fields.createdAt || getTodo(record.id).projectId !== projectId)
			continue;
		transact(
			"unlink_project",
			{ id: record.id, projectId },
			{ source: "project" },
			() => ({
				changes: [
					{
						kind: "todo",
						id: record.id,
						fields: { projectId: null, projectLabel: null },
					},
				],
				result: () => ({ id: record.id }),
			}),
		);
	}
}
export function todoSummary(now = new Date()) {
	const todos = entities("todo")
		.filter((record) => record.fields.createdAt)
		.map((record) => getTodo(record.id))
		.filter((todo) => !todo.deleted && todo.state.status === "open")
		.sort(
			(a, b) =>
				(a.due?.date ?? "9999").localeCompare(b.due?.date ?? "9999") ||
				a.id.localeCompare(b.id),
		);
	const today = localDateTime(
		now,
		Intl.DateTimeFormat().resolvedOptions().timeZone,
	).date;
	const overdue = todos.filter((todo) => isOverdue(todo.due, now));
	const dueToday = todos.filter((todo) => todo.due?.date === today);
	const escapeMarkdown = (value: string) =>
		value.replace(/[\\[\]*_`<>]/g, "\\$&").replace(/\n/g, " ");
	const markdown = todos.length
		? `${todos.length} open · ${overdue.length} overdue · ${dueToday.length} due today\n\n${todos
				.slice(0, 20)
				.map(
					(todo) =>
						`- [${escapeMarkdown(todo.title)}](toby://todos/${todo.id})${todo.due ? ` · ${todo.due.date}${todo.due.time ? ` ${todo.due.time} ${todo.due.timezone}` : ""}` : ""}`,
				)
				.join("\n")}`
		: "No open todos. Create a todo in the Todos workspace or ask Toby in chat.";
	return {
		count: todos.length,
		markdown,
		overdue: overdue.slice(0, 50),
		today: dueToday.slice(0, 50),
		items: todos.slice(0, 50).map((todo) => ({
			id: todo.id,
			title: todo.title,
			detail: todo.description,
			timestamp: todo.due
				? (dueInstant(todo.due)?.toISOString() ?? `${todo.due.date}T12:00:00Z`)
				: undefined,
			url: `toby://todos/${todo.id}`,
		})),
		generatedAt: now.toISOString(),
	};
}
