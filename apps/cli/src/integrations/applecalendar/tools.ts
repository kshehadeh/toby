import { tool } from "ai";
import { z } from "zod";
import {
	type AppleCalendarEventDetail,
	createCalendarEventSync,
	deleteCalendarEventSync,
	getCalendarEventSync,
	isAppleCalendarPlatformSupported,
	listCalendarsSync,
	searchCalendarEventsSync,
	updateCalendarEventSync,
} from "./client";

const EVENT_UID_SCHEMA = z
	.string()
	.min(
		1,
		"Event uid is required (from searchCalendarEvents or createCalendarEvent)",
	);

export interface AppleCalendarToolContext {
	readonly dryRun: boolean;
	readonly appliedActions: string[];
	readonly maxResults?: number;
}

export function createAppleCalendarTools(ctx: AppleCalendarToolContext) {
	return {
		listCalendars: tool({
			description:
				"List Calendar.app calendar names and colors. Use exact calendar names when passing the `calendar` parameter to searchCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, or getCalendarEvent.",
			inputSchema: z.object({}),
			execute: async () => {
				if (!isAppleCalendarPlatformSupported()) {
					return {
						error: "Apple Calendar tools only run on macOS.",
						calendars: [],
					};
				}
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: "Would list Calendar.app calendars.",
					};
				}
				const calendars = listCalendarsSync();
				return { count: calendars.length, calendars };
			},
		}),

		searchCalendarEvents: tool({
			description:
				"Search Apple Calendar locally via Calendar.app. Returns event uid, summary, start/end dates, allDay, location, description, and calendar name. Use uid values for getCalendarEvent, updateCalendarEvent, and deleteCalendarEvent.",
			inputSchema: z.object({
				query: z.string().optional().describe("Match text in event summary"),
				calendar: z
					.string()
					.optional()
					.describe("Calendar name to search. Omit to search all calendars."),
				dateFrom: z
					.string()
					.optional()
					.describe(
						"Start date filter, e.g. 2026-01-15 or January 15, 2026. ISO 8601 or natural language accepted.",
					),
				dateTo: z
					.string()
					.optional()
					.describe(
						"End date filter, e.g. 2026-01-20 or January 20, 2026. ISO 8601 or natural language accepted.",
					),
				limit: z
					.number()
					.min(1)
					.max(200)
					.optional()
					.describe("Max results (default 30, max 200)"),
			}),
			execute: async (args) => {
				if (!isAppleCalendarPlatformSupported()) {
					return {
						error: "Apple Calendar tools only run on macOS.",
						events: [],
					};
				}
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: "Would search Apple Calendar with the given filters.",
					};
				}

				const cap = args.limit ?? ctx.maxResults ?? 30;
				const events = searchCalendarEventsSync({
					query: args.query,
					calendar: args.calendar,
					dateFrom: args.dateFrom,
					dateTo: args.dateTo,
					limit: Math.min(Math.max(1, cap), 200),
				});

				return {
					count: events.length,
					events: events.map((e) => ({
						uid: e.uid,
						summary: e.summary,
						startDate: e.startDate.toISOString(),
						endDate: e.endDate.toISOString(),
						isAllDay: e.isAllDay,
						location: e.location,
						description: e.description,
						calendar: e.calendar,
					})),
				};
			},
		}),

		getCalendarEvent: tool({
			description:
				"Get full details of a single Calendar.app event by uid, including attendee names. Use uid from searchCalendarEvents or createCalendarEvent.",
			inputSchema: z.object({
				uid: EVENT_UID_SCHEMA,
				calendar: z
					.string()
					.optional()
					.describe(
						"Calendar name to limit the search. Omit to search all calendars.",
					),
			}),
			execute: async (args) => {
				if (!isAppleCalendarPlatformSupported()) {
					return { error: "Apple Calendar tools only run on macOS." };
				}
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: `Would get event uid ${args.uid}.`,
					};
				}

				const result = getCalendarEventSync({
					uid: args.uid,
					calendar: args.calendar,
				});
				if (!("ok" in result) || result.ok === false) {
					return { error: (result as { ok: false; error: string }).error };
				}

				const detail = result as unknown as AppleCalendarEventDetail;
				return {
					uid: detail.uid,
					summary: detail.summary,
					startDate: detail.startDate.toISOString(),
					endDate: detail.endDate.toISOString(),
					isAllDay: detail.isAllDay,
					location: detail.location,
					description: detail.description,
					calendar: detail.calendar,
					attendees: detail.attendees,
				};
			},
		}),

		createCalendarEvent: tool({
			description:
				"Create a new event in Calendar.app. Returns uid for later updateCalendarEvent or deleteCalendarEvent. Dates should be ISO 8601 (e.g. 2026-01-15T09:00:00).",
			inputSchema: z.object({
				summary: z.string().min(1).describe("Event title/summary"),
				startDate: z
					.string()
					.min(1)
					.describe("Start date/time in ISO 8601 format"),
				endDate: z.string().min(1).describe("End date/time in ISO 8601 format"),
				calendar: z
					.string()
					.optional()
					.describe("Calendar name. Omit to use the default calendar."),
				location: z.string().optional().describe("Event location"),
				description: z.string().optional().describe("Event description/notes"),
				allDay: z
					.boolean()
					.optional()
					.describe(
						"True for an all-day event (start/end dates are date-only)",
					),
			}),
			execute: async (args) => {
				if (!isAppleCalendarPlatformSupported()) {
					return { error: "Apple Calendar tools only run on macOS." };
				}
				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would create event "${args.summary}" on ${args.startDate}`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}

				const result = createCalendarEventSync({
					summary: args.summary,
					startDate: args.startDate,
					endDate: args.endDate,
					calendar: args.calendar,
					location: args.location,
					description: args.description,
					allDay: args.allDay,
				});
				if (!result.ok) {
					return { error: result.error };
				}
				const line = `Created event "${args.summary}" (uid ${result.uid})`;
				ctx.appliedActions.push(line);
				return { success: true, uid: result.uid, summary: args.summary };
			},
		}),

		updateCalendarEvent: tool({
			description:
				"Update an existing Calendar.app event by uid (from searchCalendarEvents or createCalendarEvent). Only provided fields are changed.",
			inputSchema: z.object({
				uid: EVENT_UID_SCHEMA,
				calendar: z
					.string()
					.optional()
					.describe(
						"Calendar name where the event lives. Omit to search all calendars.",
					),
				summary: z.string().optional().describe("New event title"),
				startDate: z
					.string()
					.optional()
					.describe("New start date/time in ISO 8601 format"),
				endDate: z
					.string()
					.optional()
					.describe("New end date/time in ISO 8601 format"),
				location: z.string().optional().describe("New location"),
				description: z.string().optional().describe("New description/notes"),
				allDay: z.boolean().optional().describe("Change all-day status"),
			}),
			execute: async (args) => {
				if (!isAppleCalendarPlatformSupported()) {
					return { error: "Apple Calendar tools only run on macOS." };
				}

				const hasPatch =
					args.summary !== undefined ||
					args.startDate !== undefined ||
					args.endDate !== undefined ||
					args.location !== undefined ||
					args.description !== undefined ||
					args.allDay !== undefined;
				if (!hasPatch) {
					return {
						error:
							"Provide at least one of summary, startDate, endDate, location, description, or allDay to update.",
					};
				}

				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would update event uid ${args.uid}`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}

				const result = updateCalendarEventSync({
					uid: args.uid,
					calendar: args.calendar,
					summary: args.summary,
					startDate: args.startDate,
					endDate: args.endDate,
					location: args.location,
					description: args.description,
					allDay: args.allDay,
				});
				if (!result.ok) {
					return { error: result.error };
				}
				const line = `Updated event uid ${args.uid}.`;
				ctx.appliedActions.push(line);
				return { success: true, uid: args.uid };
			},
		}),

		deleteCalendarEvent: tool({
			description:
				"Delete a Calendar.app event by uid (from searchCalendarEvents or createCalendarEvent). This cannot be undone.",
			inputSchema: z.object({
				uid: EVENT_UID_SCHEMA,
				calendar: z
					.string()
					.optional()
					.describe(
						"Calendar name where the event lives. Omit to search all calendars.",
					),
			}),
			execute: async (args) => {
				if (!isAppleCalendarPlatformSupported()) {
					return { error: "Apple Calendar tools only run on macOS." };
				}
				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would delete event uid ${args.uid}`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}

				const result = deleteCalendarEventSync({
					uid: args.uid,
					calendar: args.calendar,
				});
				if (!result.ok) {
					return { error: result.error };
				}
				const line = `Deleted event uid ${args.uid}.`;
				ctx.appliedActions.push(line);
				return { success: true, uid: args.uid };
			},
		}),
	};
}
