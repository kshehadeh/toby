import {
	escapeForAppleScript,
	executeAppleScript,
	parseAppleScriptDate,
} from "../shared/applescript";

/** True when local Calendar.app automation is supported. */
export function isAppleCalendarPlatformSupported(): boolean {
	return process.platform === "darwin";
}

/**
 * Convert a date string (ISO 8601, human-readable, etc.) into an AppleScript-compatible date string.
 * AppleScript's `date` command accepts formats like "May 12, 2026" or "5/12/2026",
 * but does NOT understand ISO 8601 like "2026-05-12".
 */
export function normalizeToAppleScriptDate(input: string): string {
	const months = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	];

	// If it already looks like a natural language date (contains month name letters),
	// pass through. ISO 8601 strings like "2026-05-12T09:00:00" contain "T" but
	// should NOT be treated as natural language.
	if (/[a-zA-Z]{2,}/.test(input)) {
		return input;
	}

	const trimmed = input.trim();
	const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
	if (isoDateOnly) {
		const year = Number(isoDateOnly[1]);
		const monthIndex = Number(isoDateOnly[2]) - 1;
		const day = Number(isoDateOnly[3]);
		return `${months[monthIndex] ?? "January"} ${day}, ${year}`;
	}

	const slashDateOnly = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
	if (slashDateOnly) {
		const monthIndex = Number(slashDateOnly[1]) - 1;
		const day = Number(slashDateOnly[2]);
		const year = Number(slashDateOnly[3]);
		return `${months[monthIndex] ?? "January"} ${day}, ${year}`;
	}

	// Try ISO 8601 or numeric formats: 2026-05-12, 2026-05-12T09:00:00, 05/12/2026
	const d = new Date(input);
	if (!Number.isNaN(d.getTime())) {
		const month = months[d.getMonth()];
		const day = d.getDate();
		const year = d.getFullYear();

		const hours = d.getHours();
		const minutes = d.getMinutes();
		const seconds = d.getSeconds();
		const ampm = hours >= 12 ? "PM" : "AM";
		const h12 = hours % 12 || 12;
		const minStr = minutes.toString().padStart(2, "0");
		const secStr = seconds.toString().padStart(2, "0");
		return `${month} ${day}, ${year} ${h12}:${minStr}:${secStr} ${ampm}`;
	}

	// Fallback: return as-is and let AppleScript try to parse it
	return input;
}

export async function testAppleCalendarConnection(): Promise<void> {
	if (!isAppleCalendarPlatformSupported()) {
		throw new Error("Apple Calendar is only available on macOS.");
	}
	const result = executeAppleScript(
		buildAppLevelScript("return (count of calendars) as string"),
		{ timeoutMs: 15_000 },
	);
	if (!result.success) {
		throw new Error(result.error ?? "Calendar.app check failed.");
	}
	if (!/^\d+$/.test(result.output) || Number(result.output) < 1) {
		throw new Error("Calendar.app has no calendars configured.");
	}
}

function buildAppLevelScript(command: string): string {
	return `
tell application "Calendar"
${command}
end tell
`;
}

function buildCalendarScopedScript(calendar: string, command: string): string {
	const safe = escapeForAppleScript(calendar);
	return `
tell application "Calendar"
tell calendar "${safe}"
${command}
end tell
end tell
`;
}

// --- Calendar listing ---

const CAL_ROW_SEP = "|||CALROW|||";
const CAL_COL_SEP = "|||CALCOL|||";

export interface AppleCalendarSummary {
	readonly name: string;
	readonly color: string;
}

export function parseCalendarListOutput(raw: string): AppleCalendarSummary[] {
	const out: AppleCalendarSummary[] = [];
	for (const chunk of raw.split(CAL_ROW_SEP)) {
		const line = chunk.trim();
		if (!line) continue;
		const [name, color] = line.split(CAL_COL_SEP);
		const n = name?.trim();
		if (!n) continue;
		out.push({ name: n, color: color?.trim() ?? "" });
	}
	return out;
}

export function listCalendarsSync(): AppleCalendarSummary[] {
	if (!isAppleCalendarPlatformSupported()) {
		return [];
	}

	const script = buildAppLevelScript(`
set outputText to ""
repeat with cal in calendars
try
set calName to name of cal as string
set calColor to ""
try
set calColor to (color of cal) as string
end try
if length of outputText > 0 then set outputText to outputText & "${CAL_ROW_SEP}"
set outputText to outputText & calName & "${CAL_COL_SEP}" & calColor
end try
end repeat
return outputText
`);

	const result = executeAppleScript(script, { timeoutMs: 20_000 });
	if (!result.success || !result.output.trim()) {
		return [];
	}
	return parseCalendarListOutput(result.output);
}

export async function listCalendars(): Promise<AppleCalendarSummary[]> {
	return listCalendarsSync();
}

// --- Event types ---

const EVENT_ROW_SEP = "|||EVTROW|||";
const EVENT_COL_SEP = "|||EVTCOL|||";

const AS_DATE_TO_STRING = `((year of d) as string) & "-" & ((month of d as integer) as string) & "-" & ((day of d) as string) & "-" & ((hours of d) as string) & "-" & ((minutes of d) as string) & "-" & ((seconds of d) as string)`;

export interface AppleCalendarEventSummary {
	readonly uid: string;
	readonly summary: string;
	readonly startDate: Date;
	readonly endDate: Date;
	readonly isAllDay: boolean;
	readonly location: string;
	readonly description: string;
	readonly calendar: string;
}

export interface AppleCalendarEventDetail extends AppleCalendarEventSummary {
	readonly attendees: readonly string[];
}

function parseEventBlock(
	line: string,
	defaultCalendarName: string,
): AppleCalendarEventSummary | null {
	const parts = line.split(EVENT_COL_SEP);
	if (parts.length < 7) return null;
	const [
		uid,
		summary,
		startStr,
		endStr,
		allDayStr,
		location,
		description,
		calName,
	] = parts;
	return {
		uid: uid ?? "",
		summary: summary ?? "",
		startDate: parseAppleScriptDate(startStr ?? ""),
		endDate: parseAppleScriptDate(endStr ?? ""),
		isAllDay: allDayStr === "true",
		location: location ?? "",
		description: description ?? "",
		calendar: calName?.trim() || defaultCalendarName,
	};
}

export function parseEventListOutput(
	raw: string,
	defaultCalendarName: string,
): AppleCalendarEventSummary[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];
	return trimmed
		.split(EVENT_ROW_SEP)
		.map((chunk) => parseEventBlock(chunk, defaultCalendarName))
		.filter((e): e is AppleCalendarEventSummary => e !== null);
}

// --- Search events ---

export interface SearchAppleCalendarParams {
	readonly query?: string;
	readonly calendar?: string;
	readonly dateFrom?: string;
	readonly dateTo?: string;
	readonly limit?: number;
}

function buildEventPropertiesBlock(): string {
	return `
set evtUid to uid of evt as string
set evtSummary to summary of evt
set d to start date of evt
set evtStartStr to ${AS_DATE_TO_STRING}
set d2 to end date of evt
set evtEndStr to ${AS_DATE_TO_STRING}
set evtAllDay to allday event of evt as string
set evtLocation to ""
try
set evtLocation to location of evt
end try
set evtDescription to ""
try
set evtDescription to description of evt
end try
`;
}

function buildEventOutputBlock(indexVar: string): string {
	return `
if ${indexVar} > 0 then set outputText to outputText & "${EVENT_ROW_SEP}"
set outputText to outputText & evtUid & "${EVENT_COL_SEP}" & evtSummary & "${EVENT_COL_SEP}" & evtStartStr & "${EVENT_COL_SEP}" & evtEndStr & "${EVENT_COL_SEP}" & evtAllDay & "${EVENT_COL_SEP}" & evtLocation & "${EVENT_COL_SEP}" & evtDescription
`;
}

export function searchCalendarEventsSync(
	params: SearchAppleCalendarParams,
): AppleCalendarEventSummary[] {
	if (!isAppleCalendarPlatformSupported()) {
		return [];
	}

	const limit = Math.min(Math.max(1, params.limit ?? 30), 200);

	// Use AppleScriptObjC / EventKit for fast date-range queries.
	// Calendar.app's AppleScript `whose` clause is silently ignored for
	// Exchange/iCloud calendars, and iterating all events times out on
	// large calendars. EventKit's predicateForEventsWithStartDate:endDate:calendars:
	// queries the local EventKit database directly and is ~100x faster.
	//
	// When dateTo is a date-only string (e.g. "2026-05-14"), we advance it to
	// the start of the next day so that timed events on that day are included.
	// Without this, date-only dateTo becomes midnight of the same day, creating
	// a zero-length window that only matches all-day events.
	const dateFromISO = params.dateFrom?.trim()
		? isoToUTCString(params.dateFrom.trim())
		: null;
	const dateToISO = params.dateTo?.trim()
		? isoToUTCString(params.dateTo.trim(), { endOfRange: true })
		: null;
	const queryFilter = params.query?.trim()
		? escapeForAppleScript(params.query.trim())
		: null;

	const calendarsToSearch: string[] = [];
	if (params.calendar?.trim()) {
		calendarsToSearch.push(params.calendar.trim());
	}

	// Build the EventKit search script
	const calFilter =
		calendarsToSearch.length > 0
			? `set theNSPredicate to current application's NSPredicate's predicateWithFormat_("title IN %@", {${calendarsToSearch.map((c) => `"${escapeForAppleScript(c)}"`).join(", ")}})`
			: "set theNSPredicate to missing value";

	const startDateArg = dateFromISO
		? `set theStartDate to current application's NSDate's dateWithString:"${dateFromISO}"`
		: "set theStartDate to current application's NSDate's distantPast()";
	const endDateArg = dateToISO
		? `set theEndDate to current application's NSDate's dateWithString:"${dateToISO}"`
		: "set theEndDate to current application's NSDate's distantFuture()";

	const queryLine = queryFilter
		? `set theNSQuery to current application's NSPredicate's predicateWithFormat_("title contains[c] %K", "${queryFilter}")
set theEvents to theEvents's filteredArrayUsingPredicate:theNSQuery`
		: "";

	const script = `use AppleScript version "2.4"
use framework "Foundation"
use framework "EventKit"
set outputText to ""
set evtCount to 0
${startDateArg}
${endDateArg}
set theEKEventStore to current application's EKEventStore's alloc()'s init()
theEKEventStore's requestAccessToEntityType:0 completion:(missing value)
set theCalendars to theEKEventStore's calendarsForEntityType:0
${calFilter}
if theNSPredicate is missing value then
set calsToSearch to theCalendars
else
set calsToSearch to theCalendars's filteredArrayUsingPredicate:theNSPredicate
end if
set thePred to theEKEventStore's predicateForEventsWithStartDate:theStartDate endDate:theEndDate calendars:calsToSearch
set theEvents to (theEKEventStore's eventsMatchingPredicate:thePred)
set theEvents to theEvents's sortedArrayUsingSelector:"compareStartDateWithEvent:"
${queryLine}
repeat with i from 1 to (count of theEvents)
if evtCount >= ${limit} then exit repeat
try
set evt to item i of theEvents
set evtUid to (evt's valueForKey:"eventIdentifier") as string
set evtSummary to (evt's valueForKey:"title") as string
set evtStartDate to (evt's valueForKey:"startDate")
set evtEndDate to (evt's valueForKey:"endDate")
set evtAllDay to ((evt's valueForKey:"isAllDay") as string)
set evtLocation to ""
try
set evtLocation to ((evt's valueForKey:"location") as string)
end try
set evtDescription to ""
try
set evtDescription to ((evt's valueForKey:"description") as string)
end try
set calName to ""
try
set calName to ((evt's valueForKey:"calendar"'s valueForKey:"title") as string)
end try
set d to evtStartDate as date
set evtStartStr to ((year of d) as string) & "-" & ((month of d as integer) as string) & "-" & ((day of d) as string) & "-" & ((hours of d) as string) & "-" & ((minutes of d) as string) & "-" & ((seconds of d) as string)
set d2 to evtEndDate as date
set evtEndStr to ((year of d2) as string) & "-" & ((month of d2 as integer) as string) & "-" & ((day of d2) as string) & "-" & ((hours of d2) as string) & "-" & ((minutes of d2) as string) & "-" & ((seconds of d2) as string)
if evtCount > 0 then set outputText to outputText & "${EVENT_ROW_SEP}"
set outputText to outputText & evtUid & "${EVENT_COL_SEP}" & evtSummary & "${EVENT_COL_SEP}" & evtStartStr & "${EVENT_COL_SEP}" & evtEndStr & "${EVENT_COL_SEP}" & evtAllDay & "${EVENT_COL_SEP}" & evtLocation & "${EVENT_COL_SEP}" & evtDescription & "${EVENT_COL_SEP}" & calName
set evtCount to evtCount + 1
end try
end repeat
return outputText
`;

	const result = executeAppleScript(script, { timeoutMs: 60_000 });
	if (!result.success || !result.output.trim()) {
		return [];
	}

	return parseEventListOutput(result.output, "").slice(0, limit);
}

/**
 * Convert a date string (ISO 8601, natural language, etc.) to a UTC ISO string
 * suitable for NSDate's dateWithString: format ("yyyy-MM-dd HH:mm:ss +0000").
 *
 * When `endOfRange` is true and the input is a date-only string (no time component),
 * the result is advanced to the start of the next UTC day so that timed events on
 * the specified date fall within the search range. Without this, a date-only
 * `dateTo` becomes midnight of the same day, excluding all timed events.
 */
function isoToUTCString(
	input: string,
	opts?: { endOfRange?: boolean },
): string {
	// Try parsing as a date
	const d = new Date(input);
	if (!Number.isNaN(d.getTime())) {
		if (opts?.endOfRange && isDateOnlyInput(input)) {
			// Advance to start of next UTC day to include timed events on the target date
			d.setUTCDate(d.getUTCDate() + 1);
			d.setUTCHours(0, 0, 0, 0);
		}
		return formatAsUTCISO(d);
	}
	// Fallback: return as-is and hope NSDate can parse it
	return input;
}

/**
 * Returns true if the input string appears to be a date-only value with no time
 * component (e.g. "2026-05-14", "05/14/2026", "May 14, 2026").
 * ISO datetime strings like "2026-05-14T09:00:00" return false.
 */
function isDateOnlyInput(input: string): boolean {
	const trimmed = input.trim();
	// ISO date-only: YYYY-MM-DD with no "T" or time suffix
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return true;
	// Slash date-only: M/D/YYYY or MM/DD/YYYY
	if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) return true;
	// Natural language date-only: "May 14, 2026" (no AM/PM or HH:MM time)
	if (/^[a-zA-Z]+ \d{1,2},? \d{4}$/.test(trimmed)) return true;
	return false;
}

function formatAsUTCISO(d: Date): string {
	const y = d.getUTCFullYear();
	const mo = (d.getUTCMonth() + 1).toString().padStart(2, "0");
	const day = d.getUTCDate().toString().padStart(2, "0");
	const h = d.getUTCHours().toString().padStart(2, "0");
	const mi = d.getUTCMinutes().toString().padStart(2, "0");
	const s = d.getUTCSeconds().toString().padStart(2, "0");
	return `${y}-${mo}-${day} ${h}:${mi}:${s} +0000`;
}

export async function searchCalendarEvents(
	params: SearchAppleCalendarParams,
): Promise<AppleCalendarEventSummary[]> {
	return searchCalendarEventsSync(params);
}

// --- Get single event ---

const ATTENDEE_SEP = "|||ATTSEP|||";

export function getCalendarEventSync(params: {
	readonly uid: string;
	readonly calendar?: string;
}): AppleCalendarEventDetail | { ok: false; error: string } {
	if (!isAppleCalendarPlatformSupported()) {
		return { ok: false, error: "Apple Calendar is only available on macOS." };
	}

	const safeUid = escapeForAppleScript(params.uid);

	const attendeeBlock = `
set attText to ""
try
set atts to attendees of evt
repeat with att in atts
set attEmail to ""
try
set attEmail to email address of att as string
end try
set attName to ""
try
set attName to display name of att
end try
if length of attText > 0 then set attText to attText & "${ATTENDEE_SEP}"
if attName is not "" then
set attText to attText & attName
else
set attText to attText & attEmail
end if
end repeat
end try
`;

	const findEventInTarget = `
set matchingEvents to (events whose uid is "${safeUid}")
if (count of matchingEvents) > 0 then
set evt to item 1 of matchingEvents
${buildEventPropertiesBlock()}
${attendeeBlock}
return evtUid & "${EVENT_COL_SEP}" & evtSummary & "${EVENT_COL_SEP}" & evtStartStr & "${EVENT_COL_SEP}" & evtEndStr & "${EVENT_COL_SEP}" & evtAllDay & "${EVENT_COL_SEP}" & evtLocation & "${EVENT_COL_SEP}" & evtDescription & "${EVENT_COL_SEP}" & (name of me as string) & "${EVENT_COL_SEP}" & attText
end if
`;

	const findEventInLoop = `
set matchingEvents to (events of cal whose uid is "${safeUid}")
if (count of matchingEvents) > 0 then
set evt to item 1 of matchingEvents
${buildEventPropertiesBlock()}
${attendeeBlock}
return evtUid & "${EVENT_COL_SEP}" & evtSummary & "${EVENT_COL_SEP}" & evtStartStr & "${EVENT_COL_SEP}" & evtEndStr & "${EVENT_COL_SEP}" & evtAllDay & "${EVENT_COL_SEP}" & evtLocation & "${EVENT_COL_SEP}" & evtDescription & "${EVENT_COL_SEP}" & (name of cal as string) & "${EVENT_COL_SEP}" & attText
end if
`;

	if (params.calendar?.trim()) {
		const safeCal = escapeForAppleScript(params.calendar.trim());
		const script = buildAppLevelScript(`
try
tell calendar "${safeCal}"
${findEventInTarget}
end tell
return "not_found"
on error errMsg
return "error:" & errMsg
end try
`);
		return parseSingleEventResult(script);
	}

	const script = buildAppLevelScript(`
try
repeat with cal in calendars
tell cal
${findEventInLoop}
end tell
end repeat
return "not_found"
on error errMsg
return "error:" & errMsg
end try
`);
	return parseSingleEventResult(script);
}

function parseSingleEventResult(
	script: string,
): AppleCalendarEventDetail | { ok: false; error: string } {
	const result = executeAppleScript(script, {
		timeoutMs: 30_000,
		maxRetries: 2,
	});
	if (!result.success) {
		return { ok: false, error: result.error ?? "Failed to get event." };
	}
	const out = result.output.trim();
	if (out === "not_found") {
		return {
			ok: false,
			error: "Event not found. Verify the uid and calendar.",
		};
	}
	if (out.startsWith("error:")) {
		return { ok: false, error: out.slice("error:".length).trim() };
	}

	const parts = out.split(EVENT_COL_SEP);
	if (parts.length < 8) {
		return { ok: false, error: `Unexpected Calendar.app response: ${out}` };
	}

	const [
		uid,
		summary,
		startStr,
		endStr,
		allDayStr,
		location,
		description,
		calendar,
		attendeesStr,
	] = parts;

	const attendees = (attendeesStr ?? "")
		.split(ATTENDEE_SEP)
		.map((s) => s.trim())
		.filter(Boolean);

	return {
		uid: uid ?? "",
		summary: summary ?? "",
		startDate: parseAppleScriptDate(startStr ?? ""),
		endDate: parseAppleScriptDate(endStr ?? ""),
		isAllDay: allDayStr === "true",
		location: location ?? "",
		description: description ?? "",
		calendar: calendar ?? "",
		attendees,
	};
}

export async function getCalendarEvent(params: {
	readonly uid: string;
	readonly calendar?: string;
}): Promise<AppleCalendarEventDetail | { ok: false; error: string }> {
	return getCalendarEventSync(params);
}

// --- Create event ---

export interface CreateAppleCalendarEventParams {
	readonly summary: string;
	readonly startDate: string;
	readonly endDate: string;
	readonly calendar?: string;
	readonly location?: string;
	readonly description?: string;
	readonly allDay?: boolean;
}

function isoToAppleScriptDate(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) {
		throw new Error(`Invalid date: ${iso}`);
	}
	const months = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	];
	const month = months[d.getMonth()];
	const day = d.getDate();
	const year = d.getFullYear();
	const hours = d.getHours();
	const minutes = d.getMinutes();
	const seconds = d.getSeconds();
	const ampm = hours >= 12 ? "PM" : "AM";
	const h12 = hours % 12 || 12;
	const minStr = minutes.toString().padStart(2, "0");
	const secStr = seconds.toString().padStart(2, "0");
	return `${month} ${day}, ${year} ${h12}:${minStr}:${secStr} ${ampm}`;
}

export function createCalendarEventSync(
	params: CreateAppleCalendarEventParams,
): { ok: true; uid: string } | { ok: false; error: string } {
	if (!isAppleCalendarPlatformSupported()) {
		return { ok: false, error: "Apple Calendar is only available on macOS." };
	}

	const safeSummary = escapeForAppleScript(params.summary);
	let startAsDate: string;
	let endAsDate: string;
	try {
		startAsDate = isoToAppleScriptDate(params.startDate);
		endAsDate = isoToAppleScriptDate(params.endDate);
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : "Invalid date format.",
		};
	}

	const allDayVal = params.allDay ? "true" : "false";
	const props = `summary:"${safeSummary}", start date:date "${startAsDate}", end date:date "${endAsDate}", allday event:${allDayVal}`;

	const safeLocation = params.location
		? escapeForAppleScript(params.location)
		: null;
	const safeDescription = params.description
		? escapeForAppleScript(params.description)
		: null;

	const locationProp = safeLocation ? `, location:"${safeLocation}"` : "";
	const descriptionProp = safeDescription
		? `, description:"${safeDescription}"`
		: "";

	// Determine which calendar to create the event in
	const calendarName = params.calendar?.trim();
	if (calendarName) {
		const safeCal = escapeForAppleScript(calendarName);
		const script = buildAppLevelScript(`
try
tell calendar "${safeCal}"
set newEvent to make new event at end of events with properties {${props}${locationProp}${descriptionProp}}
set evtUid to uid of newEvent as string
return evtUid
end tell
on error errMsg
return "error:" & errMsg
end try
`);
		return parseCreateResult(script);
	}

	// Default to first available calendar
	const script = buildAppLevelScript(`
try
set targetCal to item 1 of calendars
set newEvent to make new event at end of events of targetCal with properties {${props}${locationProp}${descriptionProp}}
set evtUid to uid of newEvent as string
return evtUid
on error errMsg
return "error:" & errMsg
end try
`);
	return parseCreateResult(script);
}

function parseCreateResult(
	script: string,
): { ok: true; uid: string } | { ok: false; error: string } {
	const result = executeAppleScript(script, {
		timeoutMs: 60_000,
		maxRetries: 2,
	});
	if (!result.success) {
		return { ok: false, error: result.error ?? "Failed to create event." };
	}
	const uid = result.output.trim();
	if (uid.startsWith("error:")) {
		return { ok: false, error: uid.slice("error:".length).trim() };
	}
	if (!uid) {
		return { ok: false, error: "Calendar.app returned an empty uid." };
	}
	return { ok: true, uid };
}

export async function createCalendarEvent(
	params: CreateAppleCalendarEventParams,
): Promise<{ ok: true; uid: string } | { ok: false; error: string }> {
	return createCalendarEventSync(params);
}

// --- Update event ---

export interface UpdateAppleCalendarEventParams {
	readonly uid: string;
	readonly calendar?: string;
	readonly summary?: string;
	readonly startDate?: string;
	readonly endDate?: string;
	readonly location?: string;
	readonly description?: string;
	readonly allDay?: boolean;
}

export function updateCalendarEventSync(
	params: UpdateAppleCalendarEventParams,
): { ok: true } | { ok: false; error: string } {
	if (!isAppleCalendarPlatformSupported()) {
		return { ok: false, error: "Apple Calendar is only available on macOS." };
	}

	const safeUid = escapeForAppleScript(params.uid);

	// Build the set statements. We do NOT use a `tell evt` block — Calendar.app's
	// AppleScript handler can corrupt properties (especially end date) when nested
	// inside `tell evt`. Instead we set all properties directly on `evt`.
	// Note: optional string fields may arrive as empty strings from the AI;
	// treat empty/whitespace-only the same as undefined (skip the field).
	const startDateVal = params.startDate?.trim() || undefined;
	const endDateVal = params.endDate?.trim() || undefined;

	const setParts: string[] = [];
	if (params.summary?.trim()) {
		setParts.push(
			`set summary of evt to "${escapeForAppleScript(params.summary.trim())}"`,
		);
	}
	if (startDateVal) {
		try {
			const d = isoToAppleScriptDate(startDateVal);
			setParts.push(`set start date of evt to date "${d}"`);
		} catch (e) {
			return {
				ok: false,
				error: e instanceof Error ? e.message : "Invalid startDate format.",
			};
		}
	}
	if (endDateVal) {
		try {
			const d = isoToAppleScriptDate(endDateVal);
			setParts.push(`set end date of evt to date "${d}"`);
		} catch (e) {
			return {
				ok: false,
				error: e instanceof Error ? e.message : "Invalid endDate format.",
			};
		}
	}
	if (params.location?.trim()) {
		setParts.push(
			`set location of evt to "${escapeForAppleScript(params.location.trim())}"`,
		);
	}
	if (params.description?.trim()) {
		setParts.push(
			`set description of evt to "${escapeForAppleScript(params.description.trim())}"`,
		);
	}
	if (params.allDay !== undefined) {
		setParts.push(
			`set allday event of evt to ${params.allDay ? "true" : "false"}`,
		);
	}

	if (setParts.length === 0) {
		return {
			ok: false,
			error:
				"Provide at least one of summary, startDate, endDate, location, description, or allDay to update.",
		};
	}

	// Calendar.app AppleScript bug: setting some properties (location, description, etc.)
	// can silently reset the end date to the start date. To guard against this, we:
	//   1. Save the start and end dates as scalar integer components BEFORE any changes
	//   2. Apply the user's requested changes (without `tell evt` wrapper)
	//   3. ALWAYS explicitly re-set both start and end dates as the final operations,
	//      using the user's new values if provided, or the saved original values if not.
	// This ensures Calendar.app always receives complete date info as the last thing
	// it processes, even if internal sync would otherwise overwrite it.

	const startDateProvided = !!startDateVal;
	const endDateProvided = !!endDateVal;

	const findAndUpdateInTarget = `
set matchingEvents to (events whose uid is "${safeUid}")
if (count of matchingEvents) > 0 then
set evt to item 1 of matchingEvents
copy (start date of evt) to savedStartDate
copy (end date of evt) to savedEndDate
set savedStartYear to year of savedStartDate
set savedStartMonth to month of savedStartDate as integer
set savedStartDay to day of savedStartDate
set savedStartHour to hours of savedStartDate
set savedStartMinute to minutes of savedStartDate
set savedStartSecond to seconds of savedStartDate
set savedEndYear to year of savedEndDate
set savedEndMonth to month of savedEndDate as integer
set savedEndDay to day of savedEndDate
set savedEndHour to hours of savedEndDate
set savedEndMinute to minutes of savedEndDate
set savedEndSecond to seconds of savedEndDate
${setParts.join("\n")}
${
	startDateProvided
		? ""
		: `set d to current date
set year of d to savedStartYear
set month of d to savedStartMonth
set day of d to savedStartDay
set hours of d to savedStartHour
set minutes of d to savedStartMinute
set seconds of d to savedStartSecond
set start date of evt to d`
}
${
	endDateProvided
		? ""
		: `set d2 to current date
set year of d2 to savedEndYear
set month of d2 to savedEndMonth
set day of d2 to savedEndDay
set hours of d2 to savedEndHour
set minutes of d2 to savedEndMinute
set seconds of d2 to savedEndSecond
set end date of evt to d2`
}
return "ok"
end if
`;

	const findAndUpdateInLoop = `
set matchingEvents to (events of cal whose uid is "${safeUid}")
if (count of matchingEvents) > 0 then
set evt to item 1 of matchingEvents
copy (start date of evt) to savedStartDate
copy (end date of evt) to savedEndDate
set savedStartYear to year of savedStartDate
set savedStartMonth to month of savedStartDate as integer
set savedStartDay to day of savedStartDate
set savedStartHour to hours of savedStartDate
set savedStartMinute to minutes of savedStartDate
set savedStartSecond to seconds of savedStartDate
set savedEndYear to year of savedEndDate
set savedEndMonth to month of savedEndDate as integer
set savedEndDay to day of savedEndDate
set savedEndHour to hours of savedEndDate
set savedEndMinute to minutes of savedEndDate
set savedEndSecond to seconds of savedEndDate
${setParts.join("\n")}
${
	startDateProvided
		? ""
		: `set d to current date
set year of d to savedStartYear
set month of d to savedStartMonth
set day of d to savedStartDay
set hours of d to savedStartHour
set minutes of d to savedStartMinute
set seconds of d to savedStartSecond
set start date of evt to d`
}
${
	endDateProvided
		? ""
		: `set d2 to current date
set year of d2 to savedEndYear
set month of d2 to savedEndMonth
set day of d2 to savedEndDay
set hours of d2 to savedEndHour
set minutes of d2 to savedEndMinute
set seconds of d2 to savedEndSecond
set end date of evt to d2`
}
return "ok"
end if
`;

	if (params.calendar?.trim()) {
		const safeCal = escapeForAppleScript(params.calendar.trim());
		const script = buildAppLevelScript(`
try
tell calendar "${safeCal}"
${findAndUpdateInTarget}
end tell
return "not_found"
on error errMsg
return "error:" & errMsg
end try
`);
		return parseSimpleResult(script);
	}

	const script = buildAppLevelScript(`
try
repeat with cal in calendars
tell cal
${findAndUpdateInLoop}
end tell
end repeat
return "not_found"
on error errMsg
return "error:" & errMsg
end try
`);
	return parseSimpleResult(script);
}

// --- Delete event ---

export function deleteCalendarEventSync(params: {
	readonly uid: string;
	readonly calendar?: string;
}): { ok: true } | { ok: false; error: string } {
	if (!isAppleCalendarPlatformSupported()) {
		return { ok: false, error: "Apple Calendar is only available on macOS." };
	}

	const safeUid = escapeForAppleScript(params.uid);

	const findAndDeleteInTarget = `
set matchingEvents to (events whose uid is "${safeUid}")
if (count of matchingEvents) > 0 then
set evt to item 1 of matchingEvents
delete evt
return "ok"
end if
`;

	const findAndDeleteInLoop = `
set matchingEvents to (events of cal whose uid is "${safeUid}")
if (count of matchingEvents) > 0 then
set evt to item 1 of matchingEvents
delete evt
return "ok"
end if
`;

	if (params.calendar?.trim()) {
		const safeCal = escapeForAppleScript(params.calendar.trim());
		const script = buildAppLevelScript(`
try
tell calendar "${safeCal}"
${findAndDeleteInTarget}
end tell
return "not_found"
on error errMsg
return "error:" & errMsg
end try
`);
		return parseSimpleResult(script);
	}

	const script = buildAppLevelScript(`
try
repeat with cal in calendars
tell cal
${findAndDeleteInLoop}
end tell
end repeat
return "not_found"
on error errMsg
return "error:" & errMsg
end try
`);
	return parseSimpleResult(script);
}

export async function deleteCalendarEvent(params: {
	readonly uid: string;
	readonly calendar?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
	return deleteCalendarEventSync(params);
}

// --- Shared result parser ---

function parseSimpleResult(
	script: string,
): { ok: true } | { ok: false; error: string } {
	const result = executeAppleScript(script, {
		timeoutMs: 60_000,
		maxRetries: 2,
	});
	if (!result.success) {
		return {
			ok: false,
			error: result.error ?? "Calendar.app operation failed.",
		};
	}
	const out = result.output.trim();
	if (out === "not_found") {
		return {
			ok: false,
			error: "Event not found. Verify the uid and calendar name.",
		};
	}
	if (out.startsWith("error:")) {
		return { ok: false, error: out.slice("error:".length).trim() };
	}
	if (out === "ok") return { ok: true };
	return { ok: false, error: `Unexpected response: ${out}` };
}

export async function updateCalendarEvent(
	params: UpdateAppleCalendarEventParams,
): Promise<{ ok: true } | { ok: false; error: string }> {
	return updateCalendarEventSync(params);
}
