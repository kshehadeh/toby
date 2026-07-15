/**
 * Map a tool call to a stable resource key for deduplication.
 * Returns null when the call is not a safe re-fetchable "read" or the key
 * cannot be determined confidently (wrong keys would drop live data).
 */

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim()) return value.trim();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return undefined;
}

function firstString(
	args: Record<string, unknown>,
	keys: readonly string[],
): string | undefined {
	for (const key of keys) {
		const v = asString(args[key]);
		if (v !== undefined) return v;
	}
	return undefined;
}

function normalizeUrl(raw: string): string {
	try {
		const u = new URL(raw);
		u.hash = "";
		// Lowercase host only; keep path case.
		u.hostname = u.hostname.toLowerCase();
		return u.toString();
	} catch {
		return raw.trim();
	}
}

function joinKey(toolName: string, parts: readonly string[]): string {
	return `${toolName}:${parts.join(":")}`;
}

/** Tool-specific extractors. Order does not matter; first matching name wins. */
const TOOL_KEY_EXTRACTORS: ReadonlyMap<
	string,
	(args: Record<string, unknown>) => string | null
> = new Map([
	[
		"fetchWebContent",
		(args) => {
			const url = firstString(args, ["url"]);
			return url ? joinKey("fetchWebContent", [normalizeUrl(url)]) : null;
		},
	],
	[
		"getEmailBody",
		(args) => {
			const uid = firstString(args, ["uid", "messageUid", "messageId"]);
			if (!uid) return null;
			const mailbox = firstString(args, ["mailbox", "folder"]) ?? "INBOX";
			return joinKey("getEmailBody", [mailbox, uid]);
		},
	],
	[
		"getEmailMetadata",
		(args) => {
			const mailbox = firstString(args, ["mailbox", "folder"]) ?? "INBOX";
			const uids = args.uids ?? args.uid;
			if (Array.isArray(uids)) {
				const list = uids
					.map((u) => asString(u))
					.filter((u): u is string => u !== undefined)
					.sort();
				if (list.length === 0) return null;
				return joinKey("getEmailMetadata", [mailbox, list.join(",")]);
			}
			const uid = asString(uids);
			return uid ? joinKey("getEmailMetadata", [mailbox, uid]) : null;
		},
	],
	[
		"getCalendarEvent",
		(args) => {
			const id = firstString(args, ["eventId", "id", "calendarItemIdentifier"]);
			return id ? joinKey("getCalendarEvent", [id]) : null;
		},
	],
	[
		"searchCalendarEvents",
		(args) => {
			const query = firstString(args, ["query", "search", "text"]) ?? "";
			const start = firstString(args, ["start", "startDate", "from"]) ?? "";
			const end = firstString(args, ["end", "endDate", "to"]) ?? "";
			const calendarId =
				firstString(args, ["calendarId", "calendar", "calendarTitle"]) ?? "";
			// Only key when at least one discriminating field is present.
			if (!query && !start && !end && !calendarId) return null;
			return joinKey("searchCalendarEvents", [calendarId, start, end, query]);
		},
	],
	[
		"getNotionPage",
		(args) => {
			const id = firstString(args, ["pageId", "id"]);
			return id ? joinKey("getNotionPage", [id]) : null;
		},
	],
	[
		"listNotionBlockChildren",
		(args) => {
			const id = firstString(args, ["blockId", "pageId", "id"]);
			return id ? joinKey("listNotionBlockChildren", [id]) : null;
		},
	],
	[
		"getJiraIssue",
		(args) => {
			const key = firstString(args, ["issueKey", "key", "issueId", "id"]);
			return key ? joinKey("getJiraIssue", [key.toUpperCase()]) : null;
		},
	],
	[
		"getJiraIssueComments",
		(args) => {
			const key = firstString(args, ["issueKey", "key", "issueId", "id"]);
			return key ? joinKey("getJiraIssueComments", [key.toUpperCase()]) : null;
		},
	],
	[
		"getProjectNameById",
		(args) => {
			const id = firstString(args, ["projectId", "id"]);
			return id ? joinKey("getProjectNameById", [id]) : null;
		},
	],
	[
		"loadLocalSkillInstructions",
		(args) => {
			const names = args.skillNames ?? args.names ?? args.name;
			if (Array.isArray(names)) {
				const list = names
					.map((n) => asString(n))
					.filter((n): n is string => n !== undefined)
					.map((n) => n.toLowerCase())
					.sort();
				if (list.length === 0) return null;
				return joinKey("loadLocalSkillInstructions", [list.join(",")]);
			}
			const name = asString(names);
			return name
				? joinKey("loadLocalSkillInstructions", [name.toLowerCase()])
				: null;
		},
	],
	[
		"readTranscript",
		(args) => {
			const id = firstString(args, ["recordingId", "id"]);
			return id ? joinKey("readTranscript", [id]) : null;
		},
	],
	[
		"webSearch",
		(args) => {
			const q = firstString(args, ["query", "q", "search"]);
			return q ? joinKey("webSearch", [q.toLowerCase()]) : null;
		},
	],
	[
		"getWeather",
		(args) => {
			const place =
				firstString(args, ["place", "location", "city", "query"]) ?? "";
			const lat = firstString(args, ["latitude", "lat"]) ?? "";
			const lon = firstString(args, ["longitude", "lon", "lng"]) ?? "";
			const date = firstString(args, ["date", "day"]) ?? "";
			if (!place && !lat && !lon) return null;
			return joinKey("getWeather", [place.toLowerCase(), lat, lon, date]);
		},
	],
]);

/**
 * Generic fallbacks for common read-shaped argument names when no
 * tool-specific extractor is registered.
 */
function genericKey(
	toolName: string,
	args: Record<string, unknown>,
): string | null {
	const url = firstString(args, ["url"]);
	if (url) return joinKey(toolName, [normalizeUrl(url)]);

	const path = firstString(args, ["path", "filePath", "file"]);
	if (path) return joinKey(toolName, [path]);

	// Single-resource id fields (avoid bare `query` — searches need tool-specific keys).
	const id = firstString(args, [
		"pageId",
		"blockId",
		"issueKey",
		"eventId",
		"recordingId",
		"messageId",
		"threadId",
	]);
	if (id) return joinKey(toolName, [id]);

	return null;
}

/**
 * Resolve a stable resource key for a tool call, or null if unknown / unsafe.
 */
export function resultKey(toolName: string, args: unknown): string | null {
	const name = toolName.trim();
	if (!name) return null;

	const record = isRecord(args) ? args : {};
	const specific = TOOL_KEY_EXTRACTORS.get(name);
	if (specific) {
		return specific(record);
	}
	return genericKey(name, record);
}
