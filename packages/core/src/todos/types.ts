import { z } from "zod";

export const idSchema = z
	.string()
	.min(1)
	.max(200)
	.regex(/^[a-zA-Z0-9:_-]+$/);
export const dateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine((value) => {
		const date = new Date(`${value}T12:00:00Z`);
		return (
			Number.isFinite(date.getTime()) &&
			date.toISOString().slice(0, 10) === value
		);
	}, "Invalid calendar date");
export const dueSchema = z
	.object({
		date: dateSchema,
		time: z
			.string()
			.regex(/^([01]\d|2[0-3]):[0-5]\d$/)
			.nullable()
			.default(null),
		timezone: z
			.string()
			.max(100)
			.default("UTC")
			.refine((value) => {
				try {
					new Intl.DateTimeFormat("en", { timeZone: value });
					return true;
				} catch {
					return false;
				}
			}, "Invalid timezone"),
	})
	.strict();
export const recurrenceSchema = z
	.object({
		mode: z.enum(["calendar", "completion"]),
		unit: z.enum(["day", "week", "month", "year"]),
		interval: z.number().int().min(1).max(1000).default(1),
		weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
		endDate: dateSchema.nullable().optional(),
	})
	.strict()
	.refine(
		(value) =>
			!value.weekdays?.length ||
			(value.mode === "calendar" && value.unit === "week"),
		"Weekdays require weekly calendar recurrence",
	);

export const todoFieldsSchema = z
	.object({
		title: z.string().trim().min(1).max(1000),
		description: z.string().max(100000).default(""),
		priority: z.enum(["none", "low", "medium", "high"]).default("none"),
		listId: idSchema.default("inbox"),
		projectId: idSchema.nullable().default(null),
		projectLabel: z.string().max(1000).nullable().default(null),
		recurrence: recurrenceSchema.nullable().default(null),
	})
	.strict();
export const checklistSchema = z
	.object({
		id: idSchema,
		text: z.string().trim().min(1).max(2000),
		order: z.number().finite(),
		checked: z.boolean().default(false),
	})
	.strict();
export const reminderSchema = z
	.object({
		id: idSchema,
		at: z.string().datetime().nullable().default(null),
		offsetMinutes: z.number().int().min(0).max(525600).nullable().default(null),
		snoozedUntil: z.string().datetime().nullable().default(null),
	})
	.strict()
	.refine(
		(r) => (r.at !== null) !== (r.offsetMinutes !== null),
		"Specify an absolute reminder time or a due-time offset",
	);

export type Due = z.infer<typeof dueSchema>;
export type Recurrence = z.infer<typeof recurrenceSchema>;
export type TodoFields = z.infer<typeof todoFieldsSchema>;
export type ChecklistItem = z.infer<typeof checklistSchema>;
export type Reminder = z.infer<typeof reminderSchema>;
export type OccurrenceState = {
	status: "open" | "completed" | "skipped";
	at: string | null;
	snapshot?: TodoFields;
};
export interface Todo extends TodoFields {
	id: string;
	revision: string;
	createdAt: string;
	updatedAt: string;
	deleted: boolean;
	occurrenceId: string;
	sequence: number;
	due: Due | null;
	state: OccurrenceState;
	tags: string[];
	checklist: ChecklistItem[];
	reminders: Reminder[];
}
export type EntityKind = "todo" | "occurrence" | "list" | "tag";
export type Change = {
	kind: EntityKind;
	id: string;
	fields: Record<string, unknown>;
};
export type TodoOperation = {
	version: 1;
	id: string;
	replica: string;
	clock: number;
	at: string;
	source: string;
	changes: Change[];
};
export class TodoError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status = 400,
	) {
		super(message);
		this.name = "TodoError";
	}
}
export type MutationContext = {
	source?: string;
	idempotencyKey?: string;
	expectedRevision?: string;
	dryRun?: boolean;
	now?: string;
};
