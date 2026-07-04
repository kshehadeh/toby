import fs from "node:fs";
import { ensureLogsDir, getUnifiedLogPath } from "../config/index";

/**
 * Unified JSON-lines logger. All Toby subsystems (chat pipeline, daemon,
 * TUI server events, upgrade, native-app, macOS plugin) append structured
 * entries to a single file at `~/.toby/logs/toby.log`. The `source` field
 * discriminates which subsystem produced an entry.
 */

export type LogSource =
	| "chat"
	| "daemon"
	| "server"
	| "upgrade"
	| "native-app"
	| "macos-plugin";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type UnifiedLogEntry = {
	readonly ts: string;
	readonly source: LogSource;
	readonly level: LogLevel;
	readonly category: string;
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

let buffer: UnifiedLogEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
const exitRegisteredKey = "__tobyUnifiedLogExitRegistered";

function startFlushTimer(): void {
	if (flushTimer !== null) return;
	flushTimer = setInterval(() => {
		flushUnifiedLog();
	}, FLUSH_INTERVAL_MS);
	flushTimer.unref?.();
}

function ensureFlushOnExit(): void {
	if ((globalThis as Record<string, unknown>)[exitRegisteredKey]) return;
	(globalThis as Record<string, unknown>)[exitRegisteredKey] = true;
	process.on("exit", () => {
		flushUnifiedLogSync();
	});
}

function serializeEntry(entry: UnifiedLogEntry): string {
	return JSON.stringify(entry);
}

function parseEntry(line: string): UnifiedLogEntry | null {
	try {
		return JSON.parse(line) as UnifiedLogEntry;
	} catch {
		return null;
	}
}

function rotateIfNeeded(): void {
	const logPath = getUnifiedLogPath();
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

function writeEntries(entries: UnifiedLogEntry[]): void {
	if (entries.length === 0) return;
	ensureLogsDir();
	const logPath = getUnifiedLogPath();
	const lines = `${entries.map((e) => serializeEntry(e)).join("\n")}\n`;
	fs.appendFileSync(logPath, lines);
	rotateIfNeeded();
}

/**
 * Append a structured entry to the unified log. Buffered and flushed on
 * interval, on buffer-full, or on process exit.
 */
export function emitLog(
	source: LogSource,
	level: LogLevel,
	category: string,
	type: string,
	data?: Record<string, unknown>,
	sessionId?: string | null | undefined,
	turnIndex?: number | undefined,
): void {
	const entry: UnifiedLogEntry = {
		ts: new Date().toISOString(),
		source,
		level,
		category,
		type,
		sessionId: sessionId ?? undefined,
		turnIndex,
		data: data ? (truncate(data) as Record<string, unknown>) : undefined,
	};
	buffer.push(entry);
	if (buffer.length >= FLUSH_BUFFER_SIZE) {
		flushUnifiedLog();
	} else {
		startFlushTimer();
		ensureFlushOnExit();
	}
}

/** Flush the in-memory buffer to disk asynchronously. */
export function flushUnifiedLog(): void {
	if (buffer.length === 0) return;
	const toWrite = buffer;
	buffer = [];
	writeEntries(toWrite);
}

/** Synchronous flush for process exit. */
export function flushUnifiedLogSync(): void {
	if (buffer.length === 0) return;
	const toWrite = buffer;
	buffer = [];
	ensureLogsDir();
	const logPath = getUnifiedLogPath();
	const lines = `${toWrite.map((e) => serializeEntry(e)).join("\n")}\n`;
	fs.appendFileSync(logPath, lines);
}

/** Clear the buffer and truncate the unified log file. */
export function clearUnifiedLog(): void {
	buffer = [];
	const logPath = getUnifiedLogPath();
	if (fs.existsSync(logPath)) {
		fs.writeFileSync(logPath, "");
	}
}

/**
 * Read the last `lines` entries from the unified log, optionally filtered by
 * `predicate` (e.g. `e => e.source === "chat"`).
 */
export function readUnifiedLogTail(
	lines = 50,
	predicate?: (entry: UnifiedLogEntry) => boolean,
): UnifiedLogEntry[] {
	flushUnifiedLog();
	const logPath = getUnifiedLogPath();
	if (!fs.existsSync(logPath)) return [];

	const content = fs.readFileSync(logPath, "utf-8");
	const allLines = content.split("\n").filter(Boolean);
	const entries: UnifiedLogEntry[] = [];
	for (const line of allLines) {
		const entry = parseEntry(line);
		if (entry && (!predicate || predicate(entry))) {
			entries.push(entry);
		}
	}
	return entries.slice(-lines);
}

/**
 * Iterate every parsed entry in the unified log, optionally filtered.
 * Useful for aggregation (e.g. summing token totals for a session).
 */
export function readUnifiedLogEntries(
	predicate?: (entry: UnifiedLogEntry) => boolean,
): UnifiedLogEntry[] {
	flushUnifiedLog();
	const logPath = getUnifiedLogPath();
	if (!fs.existsSync(logPath)) return [];

	const content = fs.readFileSync(logPath, "utf-8");
	const entries: UnifiedLogEntry[] = [];
	for (const line of content.split("\n")) {
		if (!line) continue;
		const entry = parseEntry(line);
		if (entry && (!predicate || predicate(entry))) {
			entries.push(entry);
		}
	}
	return entries;
}

/** Compact single-line format for tailing in a terminal or log viewer. */
export function formatUnifiedLogEntry(entry: UnifiedLogEntry): string {
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
	return `${ts} ${levelChar} ${entry.source}:${entry.category}:${entry.type}${session}${turn}${dataParts ? ` ${dataParts}` : ""}`;
}
