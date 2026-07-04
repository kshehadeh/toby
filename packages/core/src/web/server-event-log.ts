import fs from "node:fs";
import { ensureLogsDir, getUnifiedLogPath } from "../config/index";
import {
	type LogSource,
	emitLog,
	flushUnifiedLog,
	readUnifiedLogEntries,
} from "../logging/logger";

/**
 * TUI server event log. Delegates to the unified logger with
 * `source: "server"`. Each high-level event (begin/end turn, request,
 * response, SSE frame) is emitted as a structured JSON-lines entry.
 */

const SOURCE: LogSource = "server";

export class ServerEventLog {
	private readonly sourceOverride?: LogSource;

	constructor(source?: LogSource) {
		this.sourceOverride = source;
	}

	private get source(): LogSource {
		return this.sourceOverride ?? SOURCE;
	}

	append(message: string): void {
		emitLog(this.source, "info", "server", "log", { message });
	}

	beginTurn(params: {
		readonly sessionId: string;
		readonly text: string;
		readonly url: string;
	}): void {
		emitLog(
			this.source,
			"info",
			"server",
			"begin_turn",
			{
				url: params.url,
				prompt: params.text,
			},
			params.sessionId,
		);
	}

	endTurn(): void {
		emitLog(this.source, "info", "server", "end_turn");
	}

	logRequest(method: string, url: string, body?: string): void {
		emitLog(this.source, "debug", "server", "request", {
			method,
			url,
			body,
		});
	}

	logResponseStatus(status: number): void {
		emitLog(this.source, "debug", "server", "response_status", { status });
	}

	logResponseError(body: string): void {
		emitLog(this.source, "warn", "server", "response_error", { body });
	}

	logSseRaw(line: string): void {
		emitLog(this.source, "debug", "server", "sse_raw", { line });
	}

	logSseEvent(event: string): void {
		emitLog(this.source, "debug", "server", "sse_event", { event });
	}

	logSseData(event: string, payload: string): void {
		emitLog(this.source, "debug", "server", "sse_data", { event, payload });
	}

	logMessage(message: string): void {
		emitLog(this.source, "info", "server", "message", { message });
	}
}

/**
 * Read recent server-source log lines as formatted strings. Returns the
 * formatted (`formatUnifiedLogEntry`) lines for tailing/debugging.
 */
export function readServerEventLogTail(limit = 100): string[] {
	flushUnifiedLog();
	const entries = readUnifiedLogEntries((e) => e.source === SOURCE);
	return entries.slice(-Math.max(1, limit)).map((e) => {
		const ts = e.ts.slice(11, 19);
		const data = e.data ?? {};
		const msg = typeof data.message === "string" ? data.message : "";
		const extra = Object.entries(data)
			.filter(([k]) => k !== "message")
			.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
			.join(" ");
		return msg
			? `[${ts}] ${msg}${extra ? ` ${extra}` : ""}`
			: `[${ts}] ${e.type}${extra ? ` ${extra}` : ""}`;
	});
}

/**
 * Internal helper for tests: clear server-source entries from the unified log.
 */
export function clearServerEventLog(): void {
	const remaining = readUnifiedLogEntries((e) => e.source !== SOURCE);
	ensureLogsDir();
	const logPath = getUnifiedLogPath();
	if (remaining.length === 0) {
		if (fs.existsSync(logPath)) {
			fs.writeFileSync(logPath, "");
		}
		return;
	}
	fs.writeFileSync(
		logPath,
		`${remaining.map((e) => JSON.stringify(e)).join("\n")}\n`,
	);
}
