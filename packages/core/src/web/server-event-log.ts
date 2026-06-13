import fs from "node:fs";
import path from "node:path";
import { ensureTobyDir, resolveTobyDir } from "../config/index";

export const TUI_SERVER_EVENT_LOG_FILENAME = "tui-server-events.log";

export function getTuiServerEventLogPath(): string {
	return path.join(resolveTobyDir(), TUI_SERVER_EVENT_LOG_FILENAME);
}

function timestamp(): string {
	return new Date().toISOString();
}

export class ServerEventLog {
	private readonly filePath: string;

	constructor(filePath: string = getTuiServerEventLogPath()) {
		this.filePath = filePath;
	}

	get path(): string {
		return this.filePath;
	}

	append(message: string): void {
		const line = `[${timestamp()}] ${message}\n`;
		try {
			ensureTobyDir();
			fs.appendFileSync(this.filePath, line, "utf8");
		} catch {
			// Best-effort debug log; never break chat flows.
		}
	}

	beginTurn(params: {
		readonly sessionId: string;
		readonly text: string;
		readonly url: string;
	}): void {
		this.append("----- BEGIN TURN -----");
		this.append(`request.url=${params.url}`);
		this.append(`session.id=${params.sessionId}`);
		this.append(`prompt=${params.text}`);
	}

	endTurn(): void {
		this.append("----- END TURN -----");
	}

	logRequest(method: string, url: string, body?: string): void {
		this.append(`request.method=${method}`);
		this.append(`request.url=${url}`);
		if (body !== undefined && body.length > 0) {
			this.append(`request.body=${body}`);
		}
	}

	logResponseStatus(status: number): void {
		this.append(`response.status=${status}`);
	}

	logResponseError(body: string): void {
		this.append(`response.errorBody=${body}`);
	}

	logSseRaw(line: string): void {
		this.append(`sse.raw=${line}`);
	}

	logSseEvent(event: string): void {
		this.append(`sse.event=${event}`);
	}

	logSseData(event: string, payload: string): void {
		this.append(`sse.data.event=${event} payload=${payload}`);
	}

	logMessage(message: string): void {
		this.append(message);
	}
}

export function readServerEventLogTail(limit = 100): string[] {
	const filePath = getTuiServerEventLogPath();
	if (!fs.existsSync(filePath)) {
		return [];
	}
	const raw = fs.readFileSync(filePath, "utf8");
	const lines = raw.split("\n").filter((line) => line.trim().length > 0);
	return lines.slice(-Math.max(1, limit));
}
