import { nativeRequest } from "./native-client";

type JsonRecord = Record<string, unknown>;

export type ToolDefinition = {
	name: string;
	displayName: string;
	description: string;
	readOnly?: boolean;
	inputSchema: {
		type: string;
		properties: Record<string, { type: string; description: string }>;
		required?: string[];
	};
};

function prop(
	type: string,
	description: string,
): { type: string; description: string } {
	return { type, description };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
	{
		name: "listCalendars",
		displayName: "List calendars",
		description:
			"List Calendar.app calendar names and colors. Use exact calendar names when passing the `calendar` parameter to searchCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, or getCalendarEvent.",
		readOnly: true,
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "searchCalendarEvents",
		displayName: "Search calendar events",
		description:
			"Search Apple Calendar locally via Calendar.app. Returns event uid, summary, start/end dates, allDay, location, description, and calendar name. Use uid values for getCalendarEvent, updateCalendarEvent, and deleteCalendarEvent.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				query: prop("string", "Match text in event summary"),
				calendar: prop(
					"string",
					"Calendar name to search. Omit to search all calendars.",
				),
				dateFrom: prop(
					"string",
					"Start date filter, e.g. 2026-01-15 or January 15, 2026. ISO 8601 or natural language accepted.",
				),
				dateTo: prop(
					"string",
					"End date filter, e.g. 2026-01-20 or January 20, 2026. ISO 8601 or natural language accepted.",
				),
				limit: prop("number", "Max results (default 30, max 200)"),
			},
		},
	},
	{
		name: "getCalendarEvent",
		displayName: "Get calendar event",
		description:
			"Get full details of a single Calendar.app event by uid, including attendee names. Use uid from searchCalendarEvents or createCalendarEvent.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				uid: prop("string", "Event uid"),
				calendar: prop(
					"string",
					"Calendar name to limit the search. Omit to search all calendars.",
				),
			},
			required: ["uid"],
		},
	},
	{
		name: "createCalendarEvent",
		displayName: "Create calendar event",
		description:
			"Create a new event in Calendar.app. Returns uid for later updateCalendarEvent or deleteCalendarEvent. Dates should be ISO 8601 (e.g. 2026-01-15T09:00:00).",
		inputSchema: {
			type: "object",
			properties: {
				summary: prop("string", "Event title/summary"),
				startDate: prop("string", "Start date/time in ISO 8601 format"),
				endDate: prop("string", "End date/time in ISO 8601 format"),
				calendar: prop(
					"string",
					"Calendar name. Omit to use the default calendar.",
				),
				location: prop("string", "Event location"),
				description: prop("string", "Event description/notes"),
				allDay: prop(
					"boolean",
					"True for an all-day event (start/end dates are date-only)",
				),
			},
			required: ["summary", "startDate", "endDate"],
		},
	},
	{
		name: "updateCalendarEvent",
		displayName: "Update calendar event",
		description:
			"Update an existing Calendar.app event by uid (from searchCalendarEvents or createCalendarEvent). Only provided fields are changed.",
		inputSchema: {
			type: "object",
			properties: {
				uid: prop("string", "Event uid"),
				calendar: prop(
					"string",
					"Calendar name where the event lives. Omit to search all calendars.",
				),
				summary: prop("string", "New event title"),
				startDate: prop("string", "New start date/time in ISO 8601 format"),
				endDate: prop("string", "New end date/time in ISO 8601 format"),
				location: prop("string", "New location"),
				description: prop("string", "New description/notes"),
				allDay: prop("boolean", "Change all-day status"),
			},
			required: ["uid"],
		},
	},
	{
		name: "deleteCalendarEvent",
		displayName: "Delete calendar event",
		description:
			"Delete a Calendar.app event by uid (from searchCalendarEvents or createCalendarEvent). This cannot be undone.",
		inputSchema: {
			type: "object",
			properties: {
				uid: prop("string", "Event uid"),
				calendar: prop(
					"string",
					"Calendar name where the event lives. Omit to search all calendars.",
				),
			},
			required: ["uid"],
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

export function executeTool(
	tool: string,
	input: JsonRecord,
	dryRun: boolean,
): ExecuteResult {
	switch (tool) {
		case "listCalendars": {
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: "Would list Calendar.app calendars.",
					},
					appliedActions: [],
				};
			}
			const r = nativeRequest("calendar/list");
			if (!r.ok) {
				return {
					result: {
						error: r.error ?? "Failed to list calendars.",
						calendars: [],
					},
					appliedActions: [],
				};
			}
			const data = r.data ?? {};
			return {
				result: {
					count: data.count ?? 0,
					calendars: data.calendars ?? [],
				},
				appliedActions: [],
			};
		}

		case "searchCalendarEvents": {
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: "Would search Apple Calendar with the given filters.",
					},
					appliedActions: [],
				};
			}
			const body: JsonRecord = {};
			const query = stringValue(input.query);
			if (query) body.query = query;
			const calendar = stringValue(input.calendar);
			if (calendar) body.calendar = calendar;
			const dateFrom = stringValue(input.dateFrom);
			if (dateFrom) body.dateFrom = dateFrom;
			const dateTo = stringValue(input.dateTo);
			if (dateTo) body.dateTo = dateTo;
			body.limit = Math.min(Math.max(1, intValue(input.limit) ?? 30), 200);

			const r = nativeRequest("calendar/search", body);
			if (!r.ok) {
				return {
					result: { error: r.error ?? "Search failed.", events: [] },
					appliedActions: [],
				};
			}
			const data = r.data ?? {};
			return {
				result: {
					count: data.count ?? 0,
					events: data.events ?? [],
				},
				appliedActions: [],
			};
		}

		case "getCalendarEvent": {
			const uid = stringValue(input.uid);
			if (!uid) {
				throw new ToolFailure("uid is required.");
			}
			if (dryRun) {
				return {
					result: { dryRun: true, message: `Would get event uid ${uid}.` },
					appliedActions: [],
				};
			}
			const body: JsonRecord = { uid };
			const calendar = stringValue(input.calendar);
			if (calendar) body.calendar = calendar;

			const r = nativeRequest("calendar/get", body);
			if (!r.ok) {
				return {
					result: { error: r.error ?? "Event not found." },
					appliedActions: [],
				};
			}
			return {
				result: r.data ?? {},
				appliedActions: [],
			};
		}

		case "createCalendarEvent": {
			const summary = stringValue(input.summary);
			const startDate = stringValue(input.startDate);
			const endDate = stringValue(input.endDate);
			if (!summary || !startDate || !endDate) {
				throw new ToolFailure("summary, startDate, and endDate are required.");
			}
			if (dryRun) {
				const msg = `[DRY RUN] Would create event "${summary}" on ${startDate}`;
				return {
					result: { dryRun: true, message: msg },
					appliedActions: [msg],
				};
			}
			const body: JsonRecord = { summary, startDate, endDate };
			const calendar = stringValue(input.calendar);
			if (calendar) body.calendar = calendar;
			const location = stringValue(input.location);
			if (location) body.location = location;
			const description = stringValue(input.description);
			if (description) body.description = description;
			const allDay = boolValue(input.allDay);
			if (allDay !== undefined) body.allDay = allDay;

			const r = nativeRequest("calendar/create", body);
			if (!r.ok) {
				return {
					result: { error: r.error ?? "Failed to create event." },
					appliedActions: [],
				};
			}
			const data = r.data ?? {};
			const eventUid = stringValue(data.uid) ?? "";
			const line = `Created event "${summary}" (uid ${eventUid})`;
			return {
				result: { success: true, uid: eventUid, summary },
				appliedActions: [line],
			};
		}

		case "updateCalendarEvent": {
			const uid = stringValue(input.uid);
			if (!uid) {
				throw new ToolFailure("uid is required.");
			}
			const hasPatch =
				input.summary !== undefined ||
				input.startDate !== undefined ||
				input.endDate !== undefined ||
				input.location !== undefined ||
				input.description !== undefined ||
				input.allDay !== undefined;
			if (!hasPatch) {
				return {
					result: {
						error:
							"Provide at least one of summary, startDate, endDate, location, description, or allDay to update.",
					},
					appliedActions: [],
				};
			}
			if (dryRun) {
				const msg = `[DRY RUN] Would update event uid ${uid}`;
				return {
					result: { dryRun: true, message: msg },
					appliedActions: [msg],
				};
			}
			const body: JsonRecord = { uid };
			const calendar = stringValue(input.calendar);
			if (calendar) body.calendar = calendar;
			const summary = stringValue(input.summary);
			if (summary) body.summary = summary;
			const startDate = stringValue(input.startDate);
			if (startDate) body.startDate = startDate;
			const endDate = stringValue(input.endDate);
			if (endDate) body.endDate = endDate;
			const location = stringValue(input.location);
			if (location) body.location = location;
			const description = stringValue(input.description);
			if (description) body.description = description;
			const allDay = boolValue(input.allDay);
			if (allDay !== undefined) body.allDay = allDay;

			const r = nativeRequest("calendar/update", body);
			if (!r.ok) {
				return {
					result: { error: r.error ?? "Failed to update event." },
					appliedActions: [],
				};
			}
			return {
				result: { success: true, uid },
				appliedActions: [`Updated event uid ${uid}.`],
			};
		}

		case "deleteCalendarEvent": {
			const uid = stringValue(input.uid);
			if (!uid) {
				throw new ToolFailure("uid is required.");
			}
			if (dryRun) {
				const msg = `[DRY RUN] Would delete event uid ${uid}`;
				return {
					result: { dryRun: true, message: msg },
					appliedActions: [msg],
				};
			}
			const body: JsonRecord = { uid };
			const calendar = stringValue(input.calendar);
			if (calendar) body.calendar = calendar;

			const r = nativeRequest("calendar/delete", body);
			if (!r.ok) {
				return {
					result: { error: r.error ?? "Failed to delete event." },
					appliedActions: [],
				};
			}
			return {
				result: { success: true, uid },
				appliedActions: [`Deleted event uid ${uid}.`],
			};
		}

		default:
			throw new ToolFailure(`Unknown tool: ${tool}`);
	}
}
