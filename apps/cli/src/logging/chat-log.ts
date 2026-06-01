import fs from "node:fs";
import type { ChatEvent } from "../chat-pipeline/chat-events";
import { ensureTobyDir, getLogPath } from "../config/index";

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
	readonly level: LogLevel;
	readonly category: LogCategory;
	readonly type: string;
	readonly sessionId?: string;
	readonly turnIndex?: number;
	readonly data?: Record<string, unknown>;
};

const DEFAULT_MAX_KB = 512;
const FLUSH_INTERVAL_MS = 2000;
const FLUSH_BUFFER_SIZE = 50;
const ROTATION_KEEP_RATIO = 0.6;
const TRUNCATE_MAX_CHARS = 200;

function getMaxKb(): number {
	const env = process.env.TOBY_LOG_MAX_KB?.trim();
	if (!env) return DEFAULT_MAX_KB;
	const parsed = Number.parseInt(env, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_KB;
}

function truncate(value: unknown): unknown {
	if (typeof value === "string") {
		return value.length > TRUNCATE_MAX_CHARS
			? `${value.slice(0, TRUNCATE_MAX_CHARS)}…`
			: value;
	}
	if (Array.isArray(value)) {
		return value.map(truncate);
	}
	if (value !== null && typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			result[k] = truncate(v);
		}
		return result;
	}
	return value;
}

let buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function startFlushTimer(): void {
	if (flushTimer !== null) return;
	flushTimer = setInterval(() => {
		flush();
	}, FLUSH_INTERVAL_MS);
	flushTimer.unref?.();
}

function ensureFlushOnExit(): void {
	// Only register once
	if ((globalThis as Record<string, unknown>).__tobyLogExitRegistered) return;
	(globalThis as Record<string, unknown>).__tobyLogExitRegistered = true;
	process.on("exit", () => {
		flushSync();
	});
}

function serializeEntry(entry: LogEntry): string {
	return JSON.stringify(entry);
}

function parseEntry(line: string): LogEntry | null {
	try {
		return JSON.parse(line) as LogEntry;
	} catch {
		return null;
	}
}

function rotateIfNeeded(): void {
	const logPath = getLogPath();
	if (!fs.existsSync(logPath)) return;

	const maxBytes = getMaxKb() * 1024;
	const stat = fs.statSync(logPath);
	if (stat.size <= maxBytes) return;

	const content = fs.readFileSync(logPath, "utf-8");
	const lines = content.split("\n").filter(Boolean);
	const keepCount = Math.floor(lines.length * ROTATION_KEEP_RATIO);
	if (keepCount <= 0 || keepCount >= lines.length) return;

	const kept = lines.slice(-keepCount);
	fs.writeFileSync(logPath, `${kept.join("\n")}\n`);
}

function writeEntries(entries: LogEntry[]): void {
	if (entries.length === 0) return;
	ensureTobyDir();
	const logPath = getLogPath();
	const lines = `${entries.map((e) => serializeEntry(e)).join("\n")}\n`;
	fs.appendFileSync(logPath, lines);
	rotateIfNeeded();
}

export function log(
	level: LogLevel,
	category: LogCategory,
	type: string,
	data?: Record<string, unknown>,
): void {
	const entry: LogEntry = {
		ts: new Date().toISOString(),
		level,
		category,
		type,
		data: data ? (truncate(data) as Record<string, unknown>) : undefined,
	};
	buffer.push(entry);
	if (buffer.length >= FLUSH_BUFFER_SIZE) {
		flush();
	} else {
		startFlushTimer();
		ensureFlushOnExit();
	}
}

export function logWithSession(
	sessionId: string | null | undefined,
	turnIndex: number | undefined,
	level: LogLevel,
	category: LogCategory,
	type: string,
	data?: Record<string, unknown>,
): void {
	const entry: LogEntry = {
		ts: new Date().toISOString(),
		level,
		category,
		type,
		sessionId: sessionId ?? undefined,
		turnIndex,
		data: data ? (truncate(data) as Record<string, unknown>) : undefined,
	};
	buffer.push(entry);
	if (buffer.length >= FLUSH_BUFFER_SIZE) {
		flush();
	} else {
		startFlushTimer();
		ensureFlushOnExit();
	}
}

export function flush(): void {
	if (buffer.length === 0) return;
	const toWrite = buffer;
	buffer = [];
	writeEntries(toWrite);
}

/** Synchronous flush for process exit. */
export function flushSync(): void {
	if (buffer.length === 0) return;
	const toWrite = buffer;
	buffer = [];
	ensureTobyDir();
	const logPath = getLogPath();
	const lines = `${toWrite.map((e) => serializeEntry(e)).join("\n")}\n`;
	fs.appendFileSync(logPath, lines);
}

export function clearLog(): void {
	buffer = [];
	const logPath = getLogPath();
	if (fs.existsSync(logPath)) {
		fs.writeFileSync(logPath, "");
	}
}

export function readLogTail(lines = 50): LogEntry[] {
	flush();
	const logPath = getLogPath();
	if (!fs.existsSync(logPath)) return [];

	const content = fs.readFileSync(logPath, "utf-8");
	const allLines = content.split("\n").filter(Boolean);
	const tail = allLines.slice(-lines);
	const entries: LogEntry[] = [];
	for (const line of tail) {
		const entry = parseEntry(line);
		if (entry) entries.push(entry);
	}
	return entries;
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
	const ts = entry.ts.slice(11, 19); // HH:MM:SS
	const levelChar =
		entry.level === "error"
			? "E"
			: entry.level === "warn"
				? "W"
				: entry.level === "info"
					? "I"
					: "D";
	const session = entry.sessionId ? ` [${entry.sessionId.slice(0, 8)}]` : "";
	const turn = entry.turnIndex !== undefined ? ` t${entry.turnIndex}` : "";
	const dataParts = entry.data
		? Object.entries(entry.data)
				.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
				.join(" ")
		: "";
	return `${ts} ${levelChar} ${entry.category}:${entry.type}${session}${turn}${dataParts ? ` ${dataParts}` : ""}`;
}
