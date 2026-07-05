import { nativeRequest } from "./native-client";

type JsonRecord = Record<string, unknown>;

export type ToolDefinition = {
	name: string;
	displayName: string;
	description: string;
	readOnly?: boolean;
	standardTool?: string;
	inputSchema: {
		type: string;
		properties: Record<string, JsonRecord>;
		required?: string[];
	};
};

function prop(type: string, description: string): JsonRecord {
	return { type, description };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
	{
		name: "listReminderLists",
		displayName: "List reminder lists",
		description:
			"List Reminders.app list names and colors. Use exact list names when passing the `list` parameter to searchReminders, createReminder, updateReminder, getReminder, completeReminder, or deleteReminder.",
		readOnly: true,
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "searchReminders",
		displayName: "Search reminders",
		description:
			"Search Apple Reminders locally via Reminders.app. Returns reminder id, title, notes, list, dueDate, isCompleted, completionDate, priority, and url. Use id values for getReminder, updateReminder, completeReminder, and deleteReminder.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				query: prop("string", "Match text in reminder title or notes"),
				list: prop(
					"string",
					"Reminder list name to search. Omit to search all lists.",
				),
				completed: prop(
					"boolean",
					"True for completed reminders, false for incomplete reminders. Omit to default to incomplete unless completed date filters are supplied.",
				),
				dueFrom: prop(
					"string",
					"Due date lower bound, e.g. 2026-01-15 or January 15, 2026. ISO 8601 or natural language accepted.",
				),
				dueTo: prop(
					"string",
					"Due date upper bound, e.g. 2026-01-20 or January 20, 2026. ISO 8601 or natural language accepted.",
				),
				completedFrom: prop(
					"string",
					"Completion date lower bound. Supplying this searches completed reminders.",
				),
				completedTo: prop(
					"string",
					"Completion date upper bound. Supplying this searches completed reminders.",
				),
				limit: prop("number", "Max results (default 30, max 200)"),
			},
		},
	},
	{
		name: "getOpenRemindersSummary",
		displayName: "Open reminders summary",
		description:
			"Dashboard summary of incomplete Apple Reminders. Returns a standardized shape with count, items, groups, and generatedAt. Tagged as tasks.openSummary standard tool.",
		readOnly: true,
		standardTool: "tasks.openSummary",
		inputSchema: {
			type: "object",
			properties: {
				limit: prop("number", "Max items to return (default 20)"),
			},
		},
	},
	{
		name: "getReminder",
		displayName: "Get reminder",
		description:
			"Get full details of a single Reminders.app reminder by id. Use id from searchReminders or createReminder.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				id: prop("string", "Reminder id"),
				list: prop(
					"string",
					"Reminder list name to limit lookup. Omit to search all lists.",
				),
			},
			required: ["id"],
		},
	},
	{
		name: "createReminder",
		displayName: "Create reminder",
		description:
			"Create a new reminder in Reminders.app. Returns id for later updateReminder, completeReminder, or deleteReminder. Dates should be ISO 8601 (e.g. 2026-01-15T09:00:00). Priority uses EventKit values: 0 none, 1 high, 5 medium, 9 low.",
		inputSchema: {
			type: "object",
			properties: {
				title: prop("string", "Reminder title"),
				notes: prop("string", "Optional reminder notes"),
				list: prop(
					"string",
					"Reminder list name. Omit to use the default list.",
				),
				dueDate: prop("string", "Due date/time in ISO 8601 format"),
				priority: {
					type: "number",
					description: "Priority: 0 none, 1 high, 5 medium, 9 low",
				},
				url: prop("string", "Optional URL attached to the reminder"),
			},
			required: ["title"],
		},
	},
	{
		name: "updateReminder",
		displayName: "Update reminder",
		description:
			"Update an existing Reminders.app reminder by id (from searchReminders or createReminder). Only provided fields are changed.",
		inputSchema: {
			type: "object",
			properties: {
				id: prop("string", "Reminder id"),
				title: prop("string", "New reminder title"),
				notes: prop("string", "New reminder notes"),
				list: prop("string", "Move reminder to this list name"),
				dueDate: prop("string", "New due date/time in ISO 8601 format"),
				priority: {
					type: "number",
					description: "Priority: 0 none, 1 high, 5 medium, 9 low",
				},
				url: prop("string", "New URL; empty string clears the URL"),
			},
			required: ["id"],
		},
	},
	{
		name: "completeReminder",
		displayName: "Complete reminder",
		description:
			"Mark a Reminders.app reminder complete or incomplete by id (from searchReminders or createReminder).",
		inputSchema: {
			type: "object",
			properties: {
				id: prop("string", "Reminder id"),
				completed: prop(
					"boolean",
					"True to complete, false to mark incomplete. Defaults to true.",
				),
			},
			required: ["id"],
		},
	},
	{
		name: "deleteReminder",
		displayName: "Delete reminder",
		description:
			"Delete a Reminders.app reminder by id (from searchReminders or createReminder). This cannot be undone.",
		inputSchema: {
			type: "object",
			properties: {
				id: prop("string", "Reminder id"),
			},
			required: ["id"],
		},
	},
];

export class ToolFailure extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ToolFailure";
	}
}

type ExecuteResult = {
	result: JsonRecord;
	appliedActions: string[];
};

function stringValue(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	return undefined;
}

function intValue(value: unknown): number | undefined {
	if (typeof value === "number") return Math.trunc(value);
	return undefined;
}

function boolValue(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	return undefined;
}

function copyString(input: JsonRecord, output: JsonRecord, key: string): void {
	const value = stringValue(input[key]);
	if (value !== undefined) output[key] = value;
}

function copyInt(input: JsonRecord, output: JsonRecord, key: string): void {
	const value = intValue(input[key]);
	if (value !== undefined) output[key] = value;
}

export function executeTool(
	tool: string,
	input: JsonRecord,
	dryRun: boolean,
): ExecuteResult {
	switch (tool) {
		case "listReminderLists": {
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: "Would list Reminders.app lists.",
					},
					appliedActions: [],
				};
			}
			const r = nativeRequest("reminders/lists");
			if (!r.ok) {
				return {
					result: {
						error: r.error ?? "Failed to list reminder lists.",
						lists: [],
					},
					appliedActions: [],
				};
			}
			const data = r.data ?? {};
			return {
				result: {
					count: data.count ?? 0,
					lists: data.lists ?? [],
				},
				appliedActions: [],
			};
		}

		case "searchReminders": {
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: "Would search Apple Reminders with the given filters.",
					},
					appliedActions: [],
				};
			}
			const body: JsonRecord = {};
			for (const key of [
				"query",
				"list",
				"dueFrom",
				"dueTo",
				"completedFrom",
				"completedTo",
			]) {
				copyString(input, body, key);
			}
			const completed = boolValue(input.completed);
			if (completed !== undefined) body.completed = completed;
			body.limit = Math.min(Math.max(1, intValue(input.limit) ?? 30), 200);

			const r = nativeRequest("reminders/search", body);
			if (!r.ok) {
				return {
					result: { error: r.error ?? "Search failed.", reminders: [] },
					appliedActions: [],
				};
			}
			const data = r.data ?? {};
			return {
				result: {
					count: data.count ?? 0,
					reminders: data.reminders ?? [],
				},
				appliedActions: [],
			};
		}

		case "getOpenRemindersSummary": {
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: "Would fetch open Apple Reminders summary.",
					},
					appliedActions: [],
				};
			}
			const summaryLimit = Math.min(
				Math.max(1, intValue(input.limit) ?? 20),
				200,
			);
			const r = nativeRequest("reminders/search", {
				completed: false,
				limit: summaryLimit,
			});
			if (!r.ok) {
				return {
					result: {
						count: 0,
						items: [],
						generatedAt: new Date().toISOString(),
					},
					appliedActions: [],
				};
			}
			const data = r.data ?? {};
			const reminders = (data.reminders ?? []) as JsonRecord[];
			const now = Date.now();

			const groups = new Map<string, { label: string; count: number }>();
			const items = reminders.map((reminder) => {
				const id = String(reminder.id ?? "");
				const title = String(reminder.title ?? "");
				const list = stringValue(reminder.list);
				const notes = stringValue(reminder.notes);
				const dueDate = stringValue(reminder.dueDate);
				const priority = intValue(reminder.priority) ?? 0;
				const url = stringValue(reminder.url);

				let urgency: "low" | "normal" | "high" = "normal";
				if (priority === 1) {
					urgency = "high";
				}
				if (dueDate) {
					const dueTime = new Date(dueDate).getTime();
					if (!Number.isNaN(dueTime) && dueTime < now) {
						urgency = "high";
					}
				}

				if (list) {
					const existing = groups.get(list);
					if (existing) {
						existing.count += 1;
					} else {
						groups.set(list, { label: list, count: 1 });
					}
				}

				return {
					id,
					title,
					subtitle: list,
					detail: notes,
					timestamp: dueDate,
					urgency,
					url,
					groupId: list,
				};
			});

			return {
				result: {
					count: data.count ?? reminders.length,
					groups: [...groups.entries()].map(([id, g]) => ({
						id,
						label: g.label,
						count: g.count,
					})),
					items,
					generatedAt: new Date().toISOString(),
				},
				appliedActions: [],
			};
		}

		case "getReminder": {
			const id = stringValue(input.id);
			if (!id) {
				throw new ToolFailure("id is required.");
			}
			if (dryRun) {
				return {
					result: { dryRun: true, message: `Would get reminder id ${id}.` },
					appliedActions: [],
				};
			}
			const body: JsonRecord = { id };
			copyString(input, body, "list");
			const r = nativeRequest("reminders/get", body);
			if (!r.ok) {
				return {
					result: { error: r.error ?? "Reminder not found." },
					appliedActions: [],
				};
			}
			return { result: r.data ?? {}, appliedActions: [] };
		}

		case "createReminder": {
			const title = stringValue(input.title);
			if (!title) {
				throw new ToolFailure("title is required.");
			}
			const body: JsonRecord = { title };
			for (const key of ["notes", "list", "dueDate", "url"]) {
				copyString(input, body, key);
			}
			copyInt(input, body, "priority");
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: `Would create reminder "${title}".`,
					},
					appliedActions: [],
				};
			}
			const r = nativeRequest("reminders/create", body);
			if (!r.ok) {
				return {
					result: { error: r.error ?? "Create failed." },
					appliedActions: [],
				};
			}
			return {
				result: r.data ?? {},
				appliedActions: [`Created reminder "${title}".`],
			};
		}

		case "updateReminder": {
			const id = stringValue(input.id);
			if (!id) {
				throw new ToolFailure("id is required.");
			}
			const body: JsonRecord = { id };
			for (const key of ["title", "notes", "list", "dueDate", "url"]) {
				copyString(input, body, key);
			}
			copyInt(input, body, "priority");
			if (Object.keys(body).length === 1) {
				throw new ToolFailure("At least one field besides id is required.");
			}
			if (dryRun) {
				return {
					result: { dryRun: true, message: `Would update reminder id ${id}.` },
					appliedActions: [],
				};
			}
			const r = nativeRequest("reminders/update", body);
			if (!r.ok) {
				return {
					result: { error: r.error ?? "Update failed." },
					appliedActions: [],
				};
			}
			return {
				result: r.data ?? {},
				appliedActions: [`Updated reminder ${id}.`],
			};
		}

		case "completeReminder": {
			const id = stringValue(input.id);
			if (!id) {
				throw new ToolFailure("id is required.");
			}
			const completed = boolValue(input.completed) ?? true;
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: `Would mark reminder id ${id} ${completed ? "complete" : "incomplete"}.`,
					},
					appliedActions: [],
				};
			}
			const r = nativeRequest("reminders/complete", { id, completed });
			if (!r.ok) {
				return {
					result: { error: r.error ?? "Complete failed." },
					appliedActions: [],
				};
			}
			return {
				result: r.data ?? {},
				appliedActions: [
					`${completed ? "Completed" : "Reopened"} reminder ${id}.`,
				],
			};
		}

		case "deleteReminder": {
			const id = stringValue(input.id);
			if (!id) {
				throw new ToolFailure("id is required.");
			}
			if (dryRun) {
				return {
					result: { dryRun: true, message: `Would delete reminder id ${id}.` },
					appliedActions: [],
				};
			}
			const r = nativeRequest("reminders/delete", { id });
			if (!r.ok) {
				return {
					result: { error: r.error ?? "Delete failed." },
					appliedActions: [],
				};
			}
			return {
				result: r.data ?? {},
				appliedActions: [`Deleted reminder ${id}.`],
			};
		}

		default:
			throw new ToolFailure(`Unknown tool: ${tool}`);
	}
}
