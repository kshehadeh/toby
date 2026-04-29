import { ensureTobyDir, getChatDbPath } from "../config/index";

const DEFAULT_TOOL_RESULT_TTL_MS = 5 * 60 * 1000;

type SqliteDb = {
	exec: (sql: string) => void;
	query: (sql: string) => {
		run: (params?: Record<string, unknown>) => unknown;
		get: (params?: Record<string, unknown>) => unknown;
	};
};

type ToolCacheEntry = {
	readonly expiresAt: number;
	readonly value: unknown;
};

let dbSingleton: SqliteDb | null = null;
const toolResultCacheFallback = new Map<string, ToolCacheEntry>();

const READ_ONLY_CHAT_TOOLS = new Set<string>([
	"getInboxUnreadOverview",
	"getUnreadEmailMetadataBatch",
	"getRecentEmails",
	"listLabels",
	"fetchOpenTasks",
	"fetchCompletedTasks",
	"listUsers",
	"searchUsers",
	"getUser",
	"getUserManager",
	"getUserDirectReports",
]);

function stableSerialize(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((v) => stableSerialize(v)).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>).sort(
		([a], [b]) => a.localeCompare(b),
	);
	return `{${entries
		.map(([k, v]) => `${JSON.stringify(k)}:${stableSerialize(v)}`)
		.join(",")}}`;
}

function getDb(): SqliteDb | null {
	if (dbSingleton) {
		return dbSingleton;
	}
	try {
		ensureTobyDir();
		// Runtime is Bun-first. Tests/tooling may not have bun:sqlite; fall back gracefully.
		// biome-ignore lint/suspicious/noExplicitAny: runtime-only dependency
		const bunSqlite = require("bun:sqlite") as any;
		const BunDatabase = bunSqlite.Database as new (path: string) => SqliteDb;
		const db = new BunDatabase(getChatDbPath());
		db.exec(`
CREATE TABLE IF NOT EXISTS chat_tool_result_cache (
  cache_key TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  args_json TEXT NOT NULL,
  value_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_tool_result_cache_expires_at
  ON chat_tool_result_cache(expires_at);
`);
		dbSingleton = db;
		return db;
	} catch {
		return null;
	}
}

export function isReadOnlyChatTool(toolName: string): boolean {
	return READ_ONLY_CHAT_TOOLS.has(toolName);
}

export function buildToolResultCacheKey(
	toolName: string,
	args: Record<string, unknown>,
): string {
	return `${toolName}:${stableSerialize(args)}`;
}

export function getCachedToolResult(
	toolName: string,
	args: Record<string, unknown>,
	now = Date.now(),
): { readonly hit: boolean; readonly value?: unknown } {
	const key = buildToolResultCacheKey(toolName, args);
	const db = getDb();
	if (db) {
		db.query("DELETE FROM chat_tool_result_cache WHERE expires_at <= $now").run(
			{ $now: now },
		);
		const row = db
			.query(
				`SELECT value_json as valueJson
         FROM chat_tool_result_cache
         WHERE cache_key = $key AND expires_at > $now`,
			)
			.get({ $key: key, $now: now }) as { valueJson: string } | undefined;
		if (!row?.valueJson) {
			return { hit: false };
		}
		try {
			return { hit: true, value: JSON.parse(row.valueJson) as unknown };
		} catch {
			db.query("DELETE FROM chat_tool_result_cache WHERE cache_key = $key").run(
				{
					$key: key,
				},
			);
			return { hit: false };
		}
	}
	const entry = toolResultCacheFallback.get(key);
	if (!entry) {
		return { hit: false };
	}
	if (entry.expiresAt <= now) {
		toolResultCacheFallback.delete(key);
		return { hit: false };
	}
	return { hit: true, value: entry.value };
}

export function setCachedToolResult(
	toolName: string,
	args: Record<string, unknown>,
	value: unknown,
	ttlMs = DEFAULT_TOOL_RESULT_TTL_MS,
	now = Date.now(),
): void {
	const key = buildToolResultCacheKey(toolName, args);
	const db = getDb();
	if (db) {
		db.query(
			`INSERT OR REPLACE INTO chat_tool_result_cache
       (cache_key, tool_name, args_json, value_json, expires_at, created_at)
       VALUES ($cache_key, $tool_name, $args_json, $value_json, $expires_at, $created_at)`,
		).run({
			$cache_key: key,
			$tool_name: toolName,
			$args_json: JSON.stringify(args),
			$value_json: JSON.stringify(value),
			$expires_at: now + ttlMs,
			$created_at: new Date(now).toISOString(),
		});
		return;
	}
	toolResultCacheFallback.set(key, { value, expiresAt: now + ttlMs });
}

export function clearToolResultCache(): number {
	const db = getDb();
	if (db) {
		const row = db
			.query("SELECT COUNT(*) as count FROM chat_tool_result_cache")
			.get() as { count: number } | undefined;
		const cleared = Number(row?.count ?? 0);
		db.query("DELETE FROM chat_tool_result_cache").run();
		return cleared;
	}
	const cleared = toolResultCacheFallback.size;
	toolResultCacheFallback.clear();
	return cleared;
}
