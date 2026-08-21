import fs from "node:fs";
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
 * Daemon log. Delegates to the unified logger with `source: "daemon"`.
 * Public API preserved; reads filter the unified log by `source === "daemon"`.
 */

const SOURCE = "daemon" as const;

export type DaemonLogLevel = "debug" | "info" | "warn" | "error";

export type DaemonLogCategory =
	| "daemon"
	| "scheduler"
	| "inbound"
	| "turn"
	| "plugin-poller"
	| "plugin"
	| "sync"
	| "general";

export type DaemonLogEntry = {
	readonly ts: string;
	readonly source: "daemon";
	readonly level: DaemonLogLevel;
	readonly category: DaemonLogCategory;
	readonly type: string;
	readonly data?: Record<string, unknown>;
};

function isDaemonEntry(entry: { source: string }): entry is DaemonLogEntry {
	return entry.source === SOURCE;
}

export function daemonLog(
	level: DaemonLogLevel,
	category: DaemonLogCategory,
	type: string,
	data?: Record<string, unknown>,
): void {
	emitLog(SOURCE, level, category, type, data);
}

export function flushDaemonLog(): void {
	flushUnifiedLog();
}

/** Synchronous flush for process exit. */
export function flushDaemonLogSync(): void {
	flushUnifiedLogSync();
}

export function clearDaemonLog(): void {
	// Clear only daemon-source entries from the unified log by rewriting it
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

export function readDaemonLogTail(lines = 50): DaemonLogEntry[] {
	return readUnifiedLogTail(lines, isDaemonEntry) as DaemonLogEntry[];
}

/** Compact single-line format for tailing in a terminal. */
export function formatDaemonLogEntry(entry: DaemonLogEntry): string {
	return formatUnifiedLogEntry(entry);
}
