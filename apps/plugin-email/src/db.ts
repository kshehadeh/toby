import fs from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

export interface CachedMessage {
	uid: number;
	mailbox: string;
	messageId: string;
	fromAddress: string;
	toAddress: string;
	ccAddress: string;
	subject: string;
	date: string;
	snippet: string;
	flags: string;
	hasBody: boolean;
}

export interface CachedMessageBody {
	uid: number;
	mailbox: string;
	textBody: string;
	htmlBody: string;
}

export interface SyncState {
	mailbox: string;
	lastUid: number;
	lastSyncedAt: string;
}

export interface DraftRecord {
	id: string;
	toAddress: string;
	ccAddress: string;
	bccAddress: string;
	subject: string;
	body: string;
	createdAt: string;
	updatedAt: string;
}

function resolveDbPath(dataDir: string | undefined): string {
	if (dataDir) {
		fs.mkdirSync(dataDir, { recursive: true });
		return path.join(dataDir, "email.sqlite");
	}
	// Fallback for when no dataDir is provided (e.g. status without envelope)
	const fallback = path.join(process.cwd(), ".email-cache");
	fs.mkdirSync(fallback, { recursive: true });
	return path.join(fallback, "email.sqlite");
}

/**
 * Open (or create) the SQLite database at the given data directory.
 * Returns a thin wrapper with query helpers.
 */
export function openDb(dataDir: string | undefined): EmailDb {
	const dbPath = resolveDbPath(dataDir);
	const db = openDatabase(dbPath);
	ensureSchema(db);
	return new EmailDb(db);
}

function openDatabase(dbPath: string): Database {
	// Use dynamic import so the module doesn't crash at import time
	// in environments where bun:sqlite isn't available (e.g. plain Node).
	// biome-ignore lint/suspicious/noExplicitAny:
	const { Database } = require("bun:sqlite") as any;
	return new Database(dbPath) as Database;
}

type Database = {
	run(sql: string, ...params: unknown[]): unknown;
	query<T>(sql: string): {
		all(...params: unknown[]): T[];
		get(...params: unknown[]): T | null;
	};
	close(): void;
};

const SCHEMA_SQL = [
	`CREATE TABLE IF NOT EXISTS messages (
		uid INTEGER NOT NULL,
		mailbox TEXT NOT NULL,
		message_id TEXT,
		from_address TEXT,
		to_address TEXT,
		cc_address TEXT,
		subject TEXT,
		date TEXT,
		snippet TEXT,
		flags TEXT,
		has_body INTEGER DEFAULT 0,
		text_body TEXT,
		html_body TEXT,
		fetched_at TEXT,
		PRIMARY KEY (uid, mailbox)
	)`,
	"CREATE INDEX IF NOT EXISTS idx_messages_mailbox ON messages(mailbox)",
	"CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date DESC)",
	`CREATE TABLE IF NOT EXISTS sync_state (
		mailbox TEXT PRIMARY KEY,
		last_uid INTEGER,
		last_synced_at TEXT
	)`,
	`CREATE TABLE IF NOT EXISTS drafts (
		id TEXT PRIMARY KEY,
		to_address TEXT,
		cc_address TEXT,
		bcc_address TEXT,
		subject TEXT,
		body TEXT,
		created_at TEXT,
		updated_at TEXT
	)`,
];

function ensureSchema(db: Database): void {
	for (const sql of SCHEMA_SQL) {
		db.run(sql);
	}
}

export class EmailDb {
	readonly #db: Database;

	constructor(db: Database) {
		this.#db = db;
	}

	close(): void {
		this.#db.close();
	}

	upsertMessage(msg: {
		uid: number;
		mailbox: string;
		messageId: string;
		fromAddress: string;
		toAddress: string;
		ccAddress: string;
		subject: string;
		date: string;
		snippet: string;
		flags: string;
	}): void {
		this.#db.run(
			`INSERT OR REPLACE INTO messages
				(uid, mailbox, message_id, from_address, to_address, cc_address, subject, date, snippet, flags, has_body, fetched_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
			msg.uid,
			msg.mailbox,
			msg.messageId,
			msg.fromAddress,
			msg.toAddress,
			msg.ccAddress,
			msg.subject,
			msg.date,
			msg.snippet,
			msg.flags,
			new Date().toISOString(),
		);
	}

	setMessageBody(
		uid: number,
		mailbox: string,
		textBody: string,
		htmlBody: string,
	): void {
		this.#db.run(
			"UPDATE messages SET text_body = ?, html_body = ?, has_body = 1 WHERE uid = ? AND mailbox = ?",
			textBody,
			htmlBody,
			uid,
			mailbox,
		);
	}

	getMessages(mailbox: string, limit: number, offset: number): CachedMessage[] {
		return this.#db
			.query<CachedMessage>(
				`SELECT uid, mailbox, message_id AS messageId, from_address AS fromAddress,
				to_address AS toAddress, cc_address AS ccAddress, subject, date, snippet, flags, has_body AS hasBody
				FROM messages WHERE mailbox = ? ORDER BY date DESC LIMIT ? OFFSET ?`,
			)
			.all(mailbox, limit, offset);
	}

	getMessageByUid(uid: number, mailbox: string): CachedMessage | null {
		return this.#db
			.query<CachedMessage>(
				`SELECT uid, mailbox, message_id AS messageId, from_address AS fromAddress,
				to_address AS toAddress, cc_address AS ccAddress, subject, date, snippet, flags, has_body AS hasBody
				FROM messages WHERE uid = ? AND mailbox = ?`,
			)
			.get(uid, mailbox);
	}

	getMessageBody(uid: number, mailbox: string): CachedMessageBody | null {
		return this.#db
			.query<CachedMessageBody>(
				`SELECT uid, mailbox, text_body AS textBody, html_body AS htmlBody
				FROM messages WHERE uid = ? AND mailbox = ? AND has_body = 1`,
			)
			.get(uid, mailbox);
	}

	searchMessages(
		query: string,
		mailbox: string,
		limit: number,
	): CachedMessage[] {
		const pattern = `%${query}%`;
		return this.#db
			.query<CachedMessage>(
				`SELECT uid, mailbox, message_id AS messageId, from_address AS fromAddress,
				to_address AS toAddress, cc_address AS ccAddress, subject, date, snippet, flags, has_body AS hasBody
				FROM messages WHERE mailbox = ? AND (subject LIKE ? OR from_address LIKE ? OR to_address LIKE ? OR snippet LIKE ?)
				ORDER BY date DESC LIMIT ?`,
			)
			.all(mailbox, pattern, pattern, pattern, pattern, limit);
	}

	getSyncState(mailbox: string): SyncState | null {
		return this.#db
			.query<SyncState>(
				"SELECT mailbox, last_uid AS lastUid, last_synced_at AS lastSyncedAt FROM sync_state WHERE mailbox = ?",
			)
			.get(mailbox);
	}

	setSyncState(mailbox: string, lastUid: number): void {
		this.#db.run(
			"INSERT OR REPLACE INTO sync_state (mailbox, last_uid, last_synced_at) VALUES (?, ?, ?)",
			mailbox,
			lastUid,
			new Date().toISOString(),
		);
	}

	/** All cached UIDs for a mailbox (for reconcile / prune during sync). */
	getMessageUids(mailbox: string): number[] {
		return this.#db
			.query<{ uid: number }>(
				"SELECT uid FROM messages WHERE mailbox = ? ORDER BY uid ASC",
			)
			.all(mailbox)
			.map((row) => row.uid);
	}

	/** Replace the full flags string for a cached message. */
	setMessageFlags(uid: number, mailbox: string, flags: string): void {
		this.#db.run(
			"UPDATE messages SET flags = ? WHERE uid = ? AND mailbox = ?",
			flags,
			uid,
			mailbox,
		);
	}

	getMaxUid(mailbox: string): number {
		const row = this.#db
			.query<{ maxUid: number | null }>(
				"SELECT MAX(uid) AS maxUid FROM messages WHERE mailbox = ?",
			)
			.get(mailbox);
		return row?.maxUid ?? 0;
	}

	countMessages(mailbox: string): number {
		const row = this.#db
			.query<{ count: number }>(
				"SELECT COUNT(*) AS count FROM messages WHERE mailbox = ?",
			)
			.get(mailbox);
		return row?.count ?? 0;
	}

	createDraft(draft: DraftRecord): void {
		this.#db.run(
			`INSERT INTO drafts (id, to_address, cc_address, bcc_address, subject, body, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			draft.id,
			draft.toAddress,
			draft.ccAddress,
			draft.bccAddress,
			draft.subject,
			draft.body,
			draft.createdAt,
			draft.updatedAt,
		);
	}

	updateDraft(
		id: string,
		fields: Partial<Omit<DraftRecord, "id" | "createdAt">>,
	): void {
		const sets: string[] = [];
		const params: unknown[] = [];
		if (fields.toAddress !== undefined) {
			sets.push("to_address = ?");
			params.push(fields.toAddress);
		}
		if (fields.ccAddress !== undefined) {
			sets.push("cc_address = ?");
			params.push(fields.ccAddress);
		}
		if (fields.bccAddress !== undefined) {
			sets.push("bcc_address = ?");
			params.push(fields.bccAddress);
		}
		if (fields.subject !== undefined) {
			sets.push("subject = ?");
			params.push(fields.subject);
		}
		if (fields.body !== undefined) {
			sets.push("body = ?");
			params.push(fields.body);
		}
		sets.push("updated_at = ?");
		params.push(new Date().toISOString());
		params.push(id);
		if (sets.length > 1) {
			this.#db.run(
				`UPDATE drafts SET ${sets.join(", ")} WHERE id = ?`,
				...params,
			);
		}
	}

	getDraft(id: string): DraftRecord | null {
		return this.#db
			.query<DraftRecord>(
				`SELECT id, to_address AS toAddress, cc_address AS ccAddress, bcc_address AS bccAddress,
				subject, body, created_at AS createdAt, updated_at AS updatedAt
				FROM drafts WHERE id = ?`,
			)
			.get(id);
	}

	listDrafts(limit: number): DraftRecord[] {
		return this.#db
			.query<DraftRecord>(
				`SELECT id, to_address AS toAddress, cc_address AS ccAddress, bcc_address AS bccAddress,
				subject, body, created_at AS createdAt, updated_at AS updatedAt
				FROM drafts ORDER BY updated_at DESC LIMIT ?`,
			)
			.all(limit);
	}

	deleteDraft(id: string): boolean {
		const existing = this.getDraft(id);
		if (!existing) return false;
		this.#db.run("DELETE FROM drafts WHERE id = ?", id);
		return true;
	}

	/**
	 * Update the cached flags for one or more messages.
	 * Adds or removes a single flag from the comma-separated flags string.
	 */
	updateFlags(
		uids: number[],
		mailbox: string,
		flag: string,
		add: boolean,
	): void {
		for (const uid of uids) {
			const msg = this.getMessageByUid(uid, mailbox);
			if (!msg) continue;
			const currentFlags = msg.flags
				? msg.flags
						.split(",")
						.map((f) => f.trim())
						.filter(Boolean)
				: [];
			const flagSet = new Set(currentFlags);
			if (add) {
				flagSet.add(flag);
			} else {
				flagSet.delete(flag);
			}
			const newFlags = [...flagSet].join(",");
			this.#db.run(
				"UPDATE messages SET flags = ? WHERE uid = ? AND mailbox = ?",
				newFlags,
				uid,
				mailbox,
			);
		}
	}

	/**
	 * Remove a message from the local cache (e.g. after move or delete).
	 */
	deleteMessage(uid: number, mailbox: string): void {
		this.#db.run(
			"DELETE FROM messages WHERE uid = ? AND mailbox = ?",
			uid,
			mailbox,
		);
	}
}

export function asJsonRecord(value: unknown): JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as JsonRecord)
		: {};
}
