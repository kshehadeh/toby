import { randomUUID } from "node:crypto";
import type { CoreMessage } from "../../ai/chat";
import { ensureTobyDir, getChatDbPath } from "../../config/index";
import type { TranscriptEntry } from "./types";

type ChatSessionSummary = {
	readonly id: string;
	readonly name: string;
	readonly createdAt: string;
	readonly updatedAt: string;
};

type LoadedChatSession = {
	readonly id: string;
	readonly name: string;
	readonly messages: CoreMessage[];
	readonly transcript: TranscriptEntry[];
};

type SqliteDb = {
	exec: (sql: string) => void;
	query: (sql: string) => {
		run: (params?: Record<string, unknown>) => unknown;
		get: (params?: Record<string, unknown>) => unknown;
		all: (params?: Record<string, unknown>) => unknown[];
	};
	transaction: <T>(fn: () => T) => () => T;
	close: () => void;
};

let dbSingleton: SqliteDb | null = null;

export function closeChatDbForTests(): void {
	if (dbSingleton) {
		dbSingleton.close();
		dbSingleton = null;
	}
}

function getDb(): SqliteDb {
	if (dbSingleton) {
		return dbSingleton;
	}
	ensureTobyDir();
	// Runtime is Bun-only. Use dynamic require so Node tooling can still parse this file.
	// biome-ignore lint/suspicious/noExplicitAny: runtime-only dependency
	const bunSqlite = require("bun:sqlite") as any;
	const BunDatabase = bunSqlite.Database as new (path: string) => SqliteDb;
	const db = new BunDatabase(getChatDbPath());
	ensureSchema(db);
	dbSingleton = db;
	return db;
}

function ensureSchema(db: SqliteDb): void {
	db.exec(`
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_session_messages (
  session_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  role TEXT NOT NULL,
  content_json TEXT NOT NULL,
  PRIMARY KEY (session_id, idx),
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_session_transcript (
  session_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (session_id, idx),
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at
  ON chat_sessions(updated_at DESC);
`);
}

function nowIso(): string {
	return new Date().toISOString();
}

export function createChatSession(params?: {
	readonly name?: string;
}): ChatSessionSummary {
	const db = getDb();
	const id = randomUUID();
	const ts = nowIso();
	const name = params?.name?.trim() || "New chat";
	db.query(
		`INSERT INTO chat_sessions (id, name, created_at, updated_at)
     VALUES ($id, $name, $created_at, $updated_at)`,
	).run({ $id: id, $name: name, $created_at: ts, $updated_at: ts });
	return { id, name, createdAt: ts, updatedAt: ts };
}

export function renameChatSession(sessionId: string, name: string): void {
	const db = getDb();
	const trimmed = name.trim();
	if (!trimmed) return;
	db.query(
		"UPDATE chat_sessions SET name = $name, updated_at = $updated_at WHERE id = $id",
	).run({ $id: sessionId, $name: trimmed, $updated_at: nowIso() });
}

function touchChatSession(sessionId: string): void {
	const db = getDb();
	db.query("UPDATE chat_sessions SET updated_at = $u WHERE id = $id").run({
		$id: sessionId,
		$u: nowIso(),
	});
}

export function listChatSessions(limit = 50): ChatSessionSummary[] {
	const db = getDb();
	const rows = db
		.query(
			`SELECT id, name, created_at as createdAt, updated_at as updatedAt
       FROM chat_sessions
       ORDER BY updated_at DESC
       LIMIT $limit`,
		)
		.all({ $limit: Math.max(1, Math.min(500, limit)) }) as Array<{
		id: string;
		name: string;
		createdAt: string;
		updatedAt: string;
	}>;
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	}));
}

export function loadChatSession(sessionId: string): LoadedChatSession | null {
	const db = getDb();
	const sess = db
		.query("SELECT id, name FROM chat_sessions WHERE id = $id")
		.get({ $id: sessionId }) as { id: string; name: string } | undefined;
	if (!sess) return null;

	const msgRows = db
		.query(
			`SELECT idx, role, content_json as contentJson
       FROM chat_session_messages
       WHERE session_id = $id
       ORDER BY idx ASC`,
		)
		.all({ $id: sessionId }) as Array<{
		idx: number;
		role: CoreMessage["role"];
		contentJson: string;
	}>;

	const transcriptRows = db
		.query(
			`SELECT idx, kind, text
       FROM chat_session_transcript
       WHERE session_id = $id
       ORDER BY idx ASC`,
		)
		.all({ $id: sessionId }) as Array<{
		idx: number;
		kind: TranscriptEntry["kind"];
		text: string;
	}>;

	const messages: CoreMessage[] = msgRows.map((r) => {
		const content = JSON.parse(r.contentJson) as unknown;
		return { role: r.role as never, content } as unknown as CoreMessage;
	});
	const transcript: TranscriptEntry[] = transcriptRows.map((r) => ({
		kind: r.kind,
		text: r.text,
	}));

	return { id: sess.id, name: sess.name, messages, transcript };
}

export function clearChatSessions(): number {
	const db = getDb();
	const row = db.query("SELECT COUNT(*) as count FROM chat_sessions").get() as
		| { count: number }
		| undefined;
	const deleted = Number(row?.count ?? 0);
	const tx = db.transaction(() => {
		db.query("DELETE FROM chat_session_messages").run();
		db.query("DELETE FROM chat_session_transcript").run();
		db.query("DELETE FROM chat_sessions").run();
	});
	tx();
	return deleted;
}

export function appendMessageBatch(
	sessionId: string,
	startIdx: number,
	messages: readonly CoreMessage[],
): void {
	if (messages.length === 0) return;
	const db = getDb();
	const stmt = db.query(
		`INSERT OR REPLACE INTO chat_session_messages (session_id, idx, role, content_json)
     VALUES ($session_id, $idx, $role, $content_json)`,
	);
	const tx = db.transaction(() => {
		for (let i = 0; i < messages.length; i++) {
			const m = messages[i];
			if (!m) continue;
			stmt.run({
				$session_id: sessionId,
				$idx: startIdx + i,
				$role: m.role,
				$content_json: JSON.stringify(m.content),
			});
		}
		touchChatSession(sessionId);
	});
	tx();
}

export function appendTranscriptBatch(
	sessionId: string,
	startIdx: number,
	entries: readonly TranscriptEntry[],
): void {
	if (entries.length === 0) return;
	const db = getDb();
	const stmt = db.query(
		`INSERT OR REPLACE INTO chat_session_transcript (session_id, idx, kind, text)
     VALUES ($session_id, $idx, $kind, $text)`,
	);
	const tx = db.transaction(() => {
		for (let i = 0; i < entries.length; i++) {
			const e = entries[i];
			if (!e) continue;
			stmt.run({
				$session_id: sessionId,
				$idx: startIdx + i,
				$kind: e.kind,
				$text: e.text,
			});
		}
		touchChatSession(sessionId);
	});
	tx();
}
