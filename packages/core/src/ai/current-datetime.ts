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
