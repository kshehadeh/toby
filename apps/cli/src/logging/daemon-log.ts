import fs from "node:fs";
import { ensureTobyDir, getDaemonLogPath } from "../config/index";

export type DaemonLogLevel = "debug" | "info" | "warn" | "error";

export type DaemonLogCategory =
	| "daemon"
	| "scheduler"
	| "inbound"
	| "turn"
	| "general";

export type DaemonLogEntry = {
	readonly ts: string;
	readonly level: DaemonLogLevel;
	readonly category: DaemonLogCategory;
	readonly type: string;
	readonly data?: Record<string, unknown>;
};

const DEFAULT_MAX_KB = 512;
const FLUSH_INTERVAL_MS = 2000;
const FLUSH_BUFFER_SIZE = 50;
const ROTATION_KEEP_RATIO = 0.6;
const TRUNCATE_MAX_CHARS = 200;

function getMaxKb(): number {
	const env =
		process.env.TOBY_DAEMON_LOG_MAX_KB?.trim() ??
		process.env.TOBY_LOG_MAX_KB?.trim();
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

let buffer: DaemonLogEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function startFlushTimer(): void {
	if (flushTimer !== null) return;
	flushTimer = setInterval(() => {
		flushDaemonLog();
	}, FLUSH_INTERVAL_MS);
	flushTimer.unref?.();
}

function ensureFlushOnExit(): void {
	if ((globalThis as Record<string, unknown>).__tobyDaemonLogExitRegistered) {
		return;
	}
	(globalThis as Record<string, unknown>).__tobyDaemonLogExitRegistered = true;
	process.on("exit", () => {
		flushDaemonLogSync();
	});
}

function serializeEntry(entry: DaemonLogEntry): string {
	return JSON.stringify(entry);
}

function parseEntry(line: string): DaemonLogEntry | null {
	try {
		return JSON.parse(line) as DaemonLogEntry;
	} catch {
		return null;
	}
}

function rotateIfNeeded(): void {
	const logPath = getDaemonLogPath();
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

function writeEntries(entries: DaemonLogEntry[]): void {
	if (entries.length === 0) return;
	ensureTobyDir();
	const logPath = getDaemonLogPath();
	const lines = `${entries.map((e) => serializeEntry(e)).join("\n")}\n`;
	fs.appendFileSync(logPath, lines);
	rotateIfNeeded();
}

export function daemonLog(
	level: DaemonLogLevel,
	category: DaemonLogCategory,
	type: string,
	data?: Record<string, unknown>,
): void {
	const entry: DaemonLogEntry = {
		ts: new Date().toISOString(),
		level,
		category,
		type,
		data: data ? (truncate(data) as Record<string, unknown>) : undefined,
	};
	buffer.push(entry);
	if (buffer.length >= FLUSH_BUFFER_SIZE) {
		flushDaemonLog();
	} else {
		startFlushTimer();
		ensureFlushOnExit();
	}
}

export function flushDaemonLog(): void {
	if (buffer.length === 0) return;
	const toWrite = buffer;
	buffer = [];
	writeEntries(toWrite);
}

/** Synchronous flush for process exit. */
export function flushDaemonLogSync(): void {
	if (buffer.length === 0) return;
	const toWrite = buffer;
	buffer = [];
	ensureTobyDir();
	const logPath = getDaemonLogPath();
	const lines = `${toWrite.map((e) => serializeEntry(e)).join("\n")}\n`;
	fs.appendFileSync(logPath, lines);
}

export function clearDaemonLog(): void {
	buffer = [];
	const logPath = getDaemonLogPath();
	if (fs.existsSync(logPath)) {
		fs.writeFileSync(logPath, "");
	}
}

export function readDaemonLogTail(lines = 50): DaemonLogEntry[] {
	flushDaemonLog();
	const logPath = getDaemonLogPath();
	if (!fs.existsSync(logPath)) return [];

	const content = fs.readFileSync(logPath, "utf-8");
	const allLines = content.split("\n").filter(Boolean);
	const tail = allLines.slice(-lines);
	const entries: DaemonLogEntry[] = [];
	for (const line of tail) {
		const entry = parseEntry(line);
		if (entry) entries.push(entry);
	}
	return entries;
}

/** Compact single-line format for tailing in a terminal. */
export function formatDaemonLogEntry(entry: DaemonLogEntry): string {
	const ts = entry.ts.slice(11, 19);
	const levelChar =
		entry.level === "error"
			? "E"
			: entry.level === "warn"
				? "W"
				: entry.level === "info"
					? "I"
					: "D";
	const dataParts = entry.data
		? Object.entries(entry.data)
				.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
				.join(" ")
		: "";
	return `${ts} ${levelChar} ${entry.category}:${entry.type}${dataParts ? ` ${dataParts}` : ""}`;
}
