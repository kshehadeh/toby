import fs from "node:fs";
import type { ChatEvent } from "../chat-pipeline/chat-events";
import { ensureTobyDir, getUnifiedLogPath } from "../config/index";
import {
	emitLog,
	flushUnifiedLog,
	flushUnifiedLogSync,
	formatUnifiedLogEntry,
	readUnifiedLogEntries,
	readUnifiedLogTail,
} from "./logger";

/**
 * Chat pipeline log. Delegates to the unified logger with `source: "chat"`.
 * Public API is preserved so callers (chat pipeline, TUI, scripts) do not
 * change; reads filter the unified log by `source === "chat"`.
 */

const SOURCE = "chat" as const;
const SESSION_NOTE_MAX_CHARS = 2000;

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogCategory =
	| "session"
	| "turn"
	| "prep"
	| "tool"
	| "model"
	| "cache"
	| "general";

export type LogEntry = {
	readonly ts: string;
	readonly source: "chat";
	readonly level: LogLevel;
	readonly category: LogCategory;
	readonly type: string;
	readonly sessionId?: string;
	readonly turnIndex?: number;
	readonly data?: Record<string, unknown>;
};

function isChatEntry(entry: { source: string }): entry is LogEntry {
	return entry.source === SOURCE;
}

export function log(
	level: LogLevel,
	category: LogCategory,
	type: string,
	data?: Record<string, unknown>,
): void {
	emitLog(SOURCE, level, category, type, data);
}

export function logSessionNote(
	sessionId: string | null | undefined,
	text: string,
	data?: Record<string, unknown>,
): void {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return;
	}
	const noteText =
		trimmed.length > SESSION_NOTE_MAX_CHARS
			? `${trimmed.slice(0, SESSION_NOTE_MAX_CHARS)}…`
			: trimmed;
	logWithSession(sessionId, undefined, "info", "session", "session_note", {
		text: noteText,
		...data,
	});
}

export function logWithSession(
	sessionId: string | null | undefined,
	turnIndex: number | undefined,
	level: LogLevel,
	category: LogCategory,
	type: string,
	data?: Record<string, unknown>,
): void {
	emitLog(SOURCE, level, category, type, data, sessionId, turnIndex);
}

export function flush(): void {
	flushUnifiedLog();
}

/** Synchronous flush for process exit. */
export function flushSync(): void {
	flushUnifiedLogSync();
}

export function clearLog(): void {
	// Clear only chat-source entries from the unified log by rewriting it
	// without them. Keeps other sources intact.
	const remaining = readUnifiedLogEntries((e) => e.source !== SOURCE);
	ensureTobyDir();
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

export function readLogTail(lines = 50): LogEntry[] {
	return readUnifiedLogTail(lines, isChatEntry) as LogEntry[];
}

export type SessionTokenLogTotals = {
	readonly turnCount: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheWriteTokens: number;
};

export function aggregateSessionTokenTotalsFromLog(
	sessionId: string,
): SessionTokenLogTotals {
	const entries = readUnifiedLogEntries(
		(e) =>
			e.source === SOURCE &&
			e.type === "turn_summary" &&
			e.sessionId === sessionId,
	);

	let turnCount = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;

	for (const entry of entries) {
		const data = entry.data ?? {};
		turnCount += 1;
		if (typeof data.inputTokens === "number") {
			inputTokens += data.inputTokens;
		}
		if (typeof data.outputTokens === "number") {
			outputTokens += data.outputTokens;
		}
		if (typeof data.cacheReadTokens === "number") {
			cacheReadTokens += data.cacheReadTokens;
		}
		if (typeof data.cacheWriteTokens === "number") {
			cacheWriteTokens += data.cacheWriteTokens;
		}
	}

	return {
		turnCount,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheWriteTokens,
	};
}

export type TurnSummary = {
	readonly turnIndex?: number;
	readonly durationMs: number;
	readonly toolCallCount: number;
	readonly toolsUsed: readonly string[];
	readonly cacheHits: number;
	readonly cacheMisses: number;
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly cacheReadTokens?: number;
	readonly cacheWriteTokens?: number;
	readonly errorCount: number;
	readonly errorMessages?: readonly string[];
};

export function logTurnSummary(
	sessionId: string | null | undefined,
	turnIndex: number | undefined,
	summary: TurnSummary,
): void {
	logWithSession(sessionId, turnIndex, "info", "turn", "turn_summary", {
		turnIndex: summary.turnIndex,
		durationMs: summary.durationMs,
		toolCallCount: summary.toolCallCount,
		toolsUsed: summary.toolsUsed,
		cacheHits: summary.cacheHits,
		cacheMisses: summary.cacheMisses,
		inputTokens: summary.inputTokens,
		outputTokens: summary.outputTokens,
		cacheReadTokens: summary.cacheReadTokens,
		cacheWriteTokens: summary.cacheWriteTokens,
		errorCount: summary.errorCount,
		errorMessages: summary.errorMessages,
	});
}

export function createChatEventLogSink(
	sessionId: string | null | undefined,
	turnIndex?: number | undefined,
): (event: ChatEvent) => void {
	return (event: ChatEvent) => {
		switch (event.type) {
			case "prep_start":
				logWithSession(sessionId, turnIndex, "debug", "prep", "prep_start", {
					id: event.id,
					header: event.header,
				});
				break;
			case "prep_end":
				logWithSession(sessionId, turnIndex, "debug", "prep", "prep_end", {
					id: event.id,
					detail: event.detail,
				});
				break;
			case "lifecycle_start":
				logWithSession(
					sessionId,
					turnIndex,
					"debug",
					"general",
					"lifecycle_start",
					{ id: event.id, header: event.header },
				);
				break;
			case "lifecycle_end":
				logWithSession(
					sessionId,
					turnIndex,
					"debug",
					"general",
					"lifecycle_end",
					{ id: event.id, detail: event.detail },
				);
				break;
			case "assistant_segment_start":
				logWithSession(
					sessionId,
					turnIndex,
					"debug",
					"model",
					"assistant_segment_start",
					{ id: event.id, header: event.header },
				);
				break;
			case "assistant_text_delta":
				// Skip individual deltas to reduce volume; segment start/end is sufficient.
				break;
			case "assistant_segment_end":
				logWithSession(
					sessionId,
					turnIndex,
					"debug",
					"model",
					"assistant_segment_end",
					{ id: event.id },
				);
				break;
			case "tool_call_start":
				logWithSession(
					sessionId,
					turnIndex,
					"debug",
					"tool",
					"tool_call_start",
					{
						blockKey: event.blockKey,
						toolName: event.toolName,
					},
				);
				break;
			case "tool_call_complete": {
				const level: LogLevel = event.error ? "warn" : "debug";
				logWithSession(
					sessionId,
					turnIndex,
					level,
					"tool",
					"tool_call_complete",
					{
						blockKey: event.blockKey,
						toolName: event.toolName,
						cacheHit: event.cacheHit,
						hasError: Boolean(event.error),
					},
				);
				break;
			}
		}
	};
}

/** Format a log entry into a single compact line for the /log viewer. */
export function formatLogEntry(entry: LogEntry): string {
	return formatUnifiedLogEntry(entry);
}
