/**
 * Plugin logging helper.
 *
 * Plugins communicate with Toby via stdout (one JSON object per invocation).
 * stderr is reserved for human diagnostics — Toby captures it and may forward
 * lines to the daemon log.
 *
 * Each log line is a compact JSON object written to stderr so the daemon can
 * parse and forward it to `daemonLog` with category "plugin".
 */

type LogLevel = "debug" | "info" | "warn" | "error";

function writeLog(
	level: LogLevel,
	event: string,
	data?: Record<string, unknown>,
): void {
	const line = JSON.stringify({
		ts: new Date().toISOString(),
		level,
		event,
		...(data ? { data } : {}),
	});
	process.stderr.write(`${line}\n`);
}

export const log = {
	debug: (event: string, data?: Record<string, unknown>) =>
		writeLog("debug", event, data),
	info: (event: string, data?: Record<string, unknown>) =>
		writeLog("info", event, data),
	warn: (event: string, data?: Record<string, unknown>) =>
		writeLog("warn", event, data),
	error: (event: string, data?: Record<string, unknown>) =>
		writeLog("error", event, data),
};
