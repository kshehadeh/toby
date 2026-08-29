export type CurrentDateTimeInfo = {
	readonly timeZone: string;
	readonly localDateTime: string;
	readonly utcDateTime: string;
	readonly unixMs: number;
};

function resolveLocalTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function getCurrentDateTimeInfo(now = new Date()): CurrentDateTimeInfo {
	const timeZone = resolveLocalTimeZone();
	const localDateTime = new Intl.DateTimeFormat("en-US", {
		dateStyle: "full",
		timeStyle: "long",
		timeZone,
	}).format(now);
	return {
		timeZone,
		localDateTime,
		utcDateTime: now.toISOString(),
		unixMs: now.getTime(),
	};
}

/**
 * Markdown section describing the user's current local date/time and timezone.
 * Appended to system prompts so models can reason about relative dates and
 * convert UTC timestamps to the user's wall-clock time.
 */
export function currentDateTimePromptSection(now = new Date()): string {
	const info = getCurrentDateTimeInfo(now);
	return `## Current date and time

- Local datetime: ${info.localDateTime}
- Timezone: ${info.timeZone}
- UTC datetime: ${info.utcDateTime}
- Unix ms: ${info.unixMs}`;
}

/**
 * Render an ISO 8601 timestamp as a local wall-clock string for prompts
 * (e.g. "Saturday, August 29, 2026 at 10:00 AM EDT"). Returns the input
 * unchanged when it is not a parseable date-time. Date-only values
 * (`2026-08-29`) are returned as-is so all-day style dates are not shifted
 * into the previous local day.
 */
export function formatLocalTimestampForPrompt(timestamp: string): string {
	const trimmed = timestamp.trim();
	if (!trimmed) return timestamp;
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
	const ms = Date.parse(trimmed);
	if (Number.isNaN(ms)) return timestamp;
	const timeZone = resolveLocalTimeZone();
	return new Intl.DateTimeFormat("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
		timeZone,
	}).format(new Date(ms));
}
