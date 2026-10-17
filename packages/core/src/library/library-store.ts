import { randomUUID } from "node:crypto";
import { bufferToVector } from "../ai/vector";
import { ensureTobyDir, getChatDbPath } from "../config/index";
import { escapeLikePattern } from "../memory/keywords";
import type {
	LibraryItem,
	LibraryItemSource,
	LibraryItemStatus,
	LibraryReference,
	LibraryReferenceInput,
	LibraryReferenceKind,
} from "./types";

type SqliteDb = {
	exec: (sql: string) => void;
	serialize: () => Uint8Array;
	query: (sql: string) => {
		run: (params?: Record<string, unknown>) => unknown;
		get: (params?: Record<string, unknown>) => unknown;
		all: (params?: Record<string, unknown>) => unknown[];
	};
	transaction: <T>(fn: () => T) => () => T;
	close: () => void;
};

let dbSingleton: SqliteDb | null = null;
let backgroundEpoch = 0;

/** Bumps when the library database is closed so in-flight indexing can stop. */
export function libraryBackgroundEpoch(): number {
	return backgroundEpoch;
}

export function isLibraryWorkCurrent(
	epoch: number,
	tobyDir: string | undefined,
): boolean {
	return backgroundEpoch === epoch && process.env.TOBY_DIR === tobyDir;
}

export function closeLibraryDbForTests(): void {
	closeLibraryDb();
}

/** Close the shared handle before an on-disk database replacement. */
export function closeLibraryDb(): void {
	backgroundEpoch += 1;
	if (dbSingleton) {
		dbSingleton.close();
		dbSingleton = null;
	}
}

export function getLibraryDb(): SqliteDb {
	if (dbSingleton) {
		return dbSingleton;
	}
	ensureTobyDir();
	// biome-ignore lint/suspicious/noExplicitAny: runtime-only dependency
	const bunSqlite = require("bun:sqlite") as any;
	const BunDatabase = bunSqlite.Database as new (path: string) => SqliteDb;
	const db = new BunDatabase(getChatDbPath());
	db.exec("PRAGMA foreign_keys = ON");
	ensureSchema(db);
	dbSingleton = db;
	return db;
}

function ensureSchema(db: SqliteDb): void {
	db.exec(`
CREATE TABLE IF NOT EXISTS library_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  error TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_library_items_content_hash
  ON library_items(content_hash);

CREATE INDEX IF NOT EXISTS idx_library_items_updated
  ON library_items(updated_at DESC);

CREATE TABLE IF NOT EXISTS library_embeddings (
  item_id TEXT PRIMARY KEY,
  embedding_blob BLOB NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES library_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS library_references (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  session_id TEXT,
  project_id TEXT,
  label TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES library_items(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_library_references_origin
  ON library_references(
    item_id,
    kind,
    IFNULL(session_id, ''),
    IFNULL(project_id, ''),
    IFNULL(detail, '')
  );

CREATE INDEX IF NOT EXISTS idx_library_references_item
  ON library_references(item_id, created_at);

CREATE TABLE IF NOT EXISTS library_catalog_seen (
  origin_key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);
	backfillManualReferences(db);
}

function backfillManualReferences(db: SqliteDb): void {
	const rows = db
		.query(
			`SELECT id, created_at AS createdAt
       FROM library_items
       WHERE id NOT IN (SELECT item_id FROM library_references)`,
		)
		.all() as Array<{ id: string; createdAt: string }>;
	if (rows.length === 0) return;
	const insert = db.query(
		`INSERT INTO library_references (
       id, item_id, kind, session_id, project_id, label, detail, created_at
     ) VALUES (
       $id, $itemId, 'manual', NULL, NULL, 'Library', NULL, $createdAt
     )`,
	);
	const tx = db.transaction(() => {
		for (const row of rows) {
			insert.run({
				$id: randomUUID(),
				$itemId: row.id,
				$createdAt: row.createdAt,
			});
		}
	});
	tx();
}

function nowIso(): string {
	return new Date().toISOString();
}

type LibraryItemRow = {
	id: string;
	title: string;
	original_filename: string;
	relative_path: string;
	mime_type: string;
	byte_size: number;
	content_hash: string;
	description: string;
	status: string;
	error: string | null;
	source: string;
	created_at: string;
	updated_at: string;
	embedding_model: string | null;
};

const ITEM_SELECT = `SELECT i.id AS id, i.title AS title, i.original_filename AS original_filename,
       i.relative_path AS relative_path, i.mime_type AS mime_type, i.byte_size AS byte_size,
       i.content_hash AS content_hash, i.description AS description, i.status AS status,
       i.error AS error, i.source AS source, i.created_at AS created_at,
       i.updated_at AS updated_at, e.model AS embedding_model
       FROM library_items i
       LEFT JOIN library_embeddings e ON e.item_id = i.id`;

function rowToItem(row: LibraryItemRow): LibraryItem {
	return {
		id: row.id,
		title: row.title,
		originalFilename: row.original_filename,
		relativePath: row.relative_path,
		mimeType: row.mime_type,
		byteSize: row.byte_size,
		contentHash: row.content_hash,
		description: row.description,
		status: row.status as LibraryItemStatus,
		error: row.error ?? undefined,
		source: row.source as LibraryItemSource,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		embeddingModel: row.embedding_model ?? undefined,
	};
}

export function insertItem(input: {
	readonly id?: string;
	readonly title: string;
	readonly originalFilename: string;
	readonly relativePath: string;
	readonly mimeType: string;
	readonly byteSize: number;
	readonly contentHash: string;
	readonly source: LibraryItemSource;
	readonly status?: LibraryItemStatus;
	readonly description?: string;
}): LibraryItem {
	const db = getLibraryDb();
	const id = input.id ?? randomUUID();
	const ts = nowIso();
	const status = input.status ?? "pending";
	const description = input.description ?? "";
	db.query(
		`INSERT INTO library_items (
      id, title, original_filename, relative_path, mime_type, byte_size,
      content_hash, description, status, error, source, created_at, updated_at
    ) VALUES (
      $id, $title, $filename, $path, $mime, $size, $hash, $desc, $status,
      NULL, $source, $ca, $ua
    )`,
	).run({
		$id: id,
		$title: input.title,
		$filename: input.originalFilename,
		$path: input.relativePath,
		$mime: input.mimeType,
		$size: input.byteSize,
		$hash: input.contentHash,
		$desc: description,
		$status: status,
		$source: input.source,
		$ca: ts,
		$ua: ts,
	});
	return {
		id,
		title: input.title,
		originalFilename: input.originalFilename,
		relativePath: input.relativePath,
		mimeType: input.mimeType,
		byteSize: input.byteSize,
		contentHash: input.contentHash,
		description,
		status,
		source: input.source,
		createdAt: ts,
		updatedAt: ts,
	};
}

export function getItem(id: string): LibraryItem | null {
	const db = getLibraryDb();
	const row = db.query(`${ITEM_SELECT} WHERE i.id = $id`).get({ $id: id }) as
		| LibraryItemRow
		| undefined;
	return row ? rowToItem(row) : null;
}

export function findItemByContentHash(hash: string): LibraryItem | null {
	const db = getLibraryDb();
	const row = db
		.query(`${ITEM_SELECT} WHERE i.content_hash = $hash LIMIT 1`)
		.get({ $hash: hash }) as LibraryItemRow | undefined;
	return row ? rowToItem(row) : null;
}

function originExistsClause(origin?: LibraryReferenceKind): string {
	if (!origin) return "";
	return `WHERE EXISTS (
    SELECT 1 FROM library_references r
    WHERE r.item_id = i.id AND r.kind = $origin
  )`;
}

export function listItems(opts?: {
	readonly limit?: number;
	readonly offset?: number;
	readonly origin?: LibraryReferenceKind;
}): LibraryItem[] {
	const db = getLibraryDb();
	const limit = Math.max(1, Math.min(opts?.limit ?? 50, 500));
	const offset = Math.max(0, opts?.offset ?? 0);
	const rows = db
		.query(
			`${ITEM_SELECT} ${originExistsClause(opts?.origin)}
       ORDER BY i.updated_at DESC LIMIT $limit OFFSET $offset`,
		)
		.all({
			$limit: limit,
			$offset: offset,
			...(opts?.origin ? { $origin: opts.origin } : {}),
		}) as LibraryItemRow[];
	return rows.map(rowToItem);
}

export function countItems(origin?: LibraryReferenceKind): number {
	const db = getLibraryDb();
	const row = db
		.query(
			`SELECT COUNT(*) AS n FROM library_items i ${originExistsClause(origin)}`,
		)
		.get(origin ? { $origin: origin } : {}) as { n: number };
	return Number(row.n ?? 0);
}

export function searchItems(query: string): LibraryItem[] {
	const db = getLibraryDb();
	const pattern = `%${escapeLikePattern(query)}%`;
	const rows = db
		.query(
			`${ITEM_SELECT}
       WHERE i.title LIKE $pat ESCAPE '!'
          OR i.description LIKE $pat ESCAPE '!'
          OR i.original_filename LIKE $pat ESCAPE '!'
       ORDER BY i.updated_at DESC`,
		)
		.all({ $pat: pattern }) as LibraryItemRow[];
	return rows.map(rowToItem);
}

export function searchItemsByKeywords(
	keywords: readonly string[],
): LibraryItem[] {
	if (keywords.length === 0) return [];
	const db = getLibraryDb();
	const clauses: string[] = [];
	const params: Record<string, unknown> = {};
	keywords.forEach((keyword, index) => {
		const key = `$pat${index}`;
		params[key] = `%${escapeLikePattern(keyword)}%`;
		clauses.push(
			`(i.title LIKE ${key} ESCAPE '!' OR i.description LIKE ${key} ESCAPE '!' OR i.original_filename LIKE ${key} ESCAPE '!')`,
		);
	});
	const rows = db
		.query(
			`${ITEM_SELECT} WHERE ${clauses.join(" OR ")} ORDER BY i.updated_at DESC`,
		)
		.all(params) as LibraryItemRow[];
	return rows.map(rowToItem);
}

export function updateItem(
	id: string,
	patch: {
		readonly title?: string;
		readonly originalFilename?: string;
		readonly relativePath?: string;
		readonly mimeType?: string;
		readonly byteSize?: number;
		readonly contentHash?: string;
		readonly description?: string;
		readonly status?: LibraryItemStatus;
		readonly error?: string | null;
	},
): LibraryItem | null {
	const existing = getItem(id);
	if (!existing) return null;
	const db = getLibraryDb();
	const ts = nowIso();
	const sets: string[] = ["updated_at = $ua"];
	const params: Record<string, unknown> = { $id: id, $ua: ts };
	if (patch.title !== undefined) {
		sets.push("title = $title");
		params.$title = patch.title;
	}
	if (patch.originalFilename !== undefined) {
		sets.push("original_filename = $filename");
		params.$filename = patch.originalFilename;
	}
	if (patch.relativePath !== undefined) {
		sets.push("relative_path = $path");
		params.$path = patch.relativePath;
	}
	if (patch.mimeType !== undefined) {
		sets.push("mime_type = $mime");
		params.$mime = patch.mimeType;
	}
	if (patch.byteSize !== undefined) {
		sets.push("byte_size = $size");
		params.$size = patch.byteSize;
	}
	if (patch.contentHash !== undefined) {
		sets.push("content_hash = $hash");
		params.$hash = patch.contentHash;
	}
	if (patch.description !== undefined) {
		sets.push("description = $desc");
		params.$desc = patch.description;
	}
	if (patch.status !== undefined) {
		sets.push("status = $status");
		params.$status = patch.status;
	}
	if (patch.error !== undefined) {
		sets.push("error = $error");
		params.$error = patch.error;
	}
	db.query(`UPDATE library_items SET ${sets.join(", ")} WHERE id = $id`).run(
		params,
	);
	return getItem(id);
}

export function deleteItem(id: string): boolean {
	const db = getLibraryDb();
	db.query("DELETE FROM library_embeddings WHERE item_id = $id").run({
		$id: id,
	});
	const result = db
		.query("DELETE FROM library_items WHERE id = $id")
		.run({ $id: id });
	return Number((result as { changes: number } | null)?.changes ?? 0) > 0;
}

export function insertEmbedding(
	itemId: string,
	blob: Buffer,
	model: string,
): void {
	const db = getLibraryDb();
	const ts = nowIso();
	db.query(
		`INSERT INTO library_embeddings (item_id, embedding_blob, model, created_at)
     VALUES ($id, $blob, $model, $ca)
     ON CONFLICT(item_id) DO UPDATE SET
       embedding_blob = excluded.embedding_blob,
       model = excluded.model,
       created_at = excluded.created_at`,
	).run({
		$id: itemId,
		$blob: blob,
		$model: model,
		$ca: ts,
	});
}

export function getEmbedding(itemId: string): {
	readonly vector: number[];
	readonly model: string;
} | null {
	const db = getLibraryDb();
	const row = db
		.query(
			"SELECT embedding_blob, model FROM library_embeddings WHERE item_id = $id",
		)
		.get({ $id: itemId }) as
		| { embedding_blob: Buffer | Uint8Array; model: string }
		| undefined;
	if (!row) return null;
	return {
		vector: bufferToVector(row.embedding_blob),
		model: row.model,
	};
}

export function listEmbeddings(): Array<{
	readonly itemId: string;
	readonly vector: number[];
	readonly model: string;
}> {
	const db = getLibraryDb();
	const rows = db
		.query("SELECT item_id, embedding_blob, model FROM library_embeddings")
		.all() as Array<{
		item_id: string;
		embedding_blob: Buffer | Uint8Array;
		model: string;
	}>;
	return rows.map((row) => ({
		itemId: row.item_id,
		vector: bufferToVector(row.embedding_blob),
		model: row.model,
	}));
}

type LibraryReferenceRow = {
	id: string;
	item_id: string;
	kind: string;
	session_id: string | null;
	project_id: string | null;
	label: string;
	detail: string | null;
	created_at: string;
};

function rowToReference(row: LibraryReferenceRow): LibraryReference {
	return {
		id: row.id,
		itemId: row.item_id,
		kind: row.kind as LibraryReferenceKind,
		label: row.label,
		detail: row.detail,
		sessionId: row.session_id,
		projectId: row.project_id,
		createdAt: row.created_at,
	};
}

export function insertReference(
	itemId: string,
	input: LibraryReferenceInput,
): void {
	const db = getLibraryDb();
	db.query(
		`INSERT OR IGNORE INTO library_references (
       id, item_id, kind, session_id, project_id, label, detail, created_at
     ) VALUES (
       $id, $itemId, $kind, $sessionId, $projectId, $label, $detail, $createdAt
     )`,
	).run({
		$id: randomUUID(),
		$itemId: itemId,
		$kind: input.kind,
		$sessionId: input.sessionId?.trim() || null,
		$projectId: input.projectId?.trim() || null,
		$label: input.label.trim() || "Library",
		$detail: input.detail?.trim() || null,
		$createdAt: nowIso(),
	});
}

export function listReferencesForItems(
	ids: readonly string[],
): Map<string, LibraryReference[]> {
	const grouped = new Map<string, LibraryReference[]>();
	if (ids.length === 0) return grouped;
	const db = getLibraryDb();
	for (let offset = 0; offset < ids.length; offset += 100) {
		const chunk = ids.slice(offset, offset + 100);
		const params: Record<string, unknown> = {};
		const placeholders = chunk.map((id, index) => {
			const key = `$id${index}`;
			params[key] = id;
			return key;
		});
		const rows = db
			.query(
				`SELECT id, item_id, kind, session_id, project_id, label, detail, created_at
         FROM library_references
         WHERE item_id IN (${placeholders.join(", ")})
         ORDER BY created_at ASC`,
			)
			.all(params) as LibraryReferenceRow[];
		for (const row of rows) {
			const reference = rowToReference(row);
			const list = grouped.get(reference.itemId) ?? [];
			list.push(reference);
			grouped.set(reference.itemId, list);
		}
	}
	return grouped;
}

export function getCatalogSeen(originKey: string): string | null {
	const db = getLibraryDb();
	const row = db
		.query(
			"SELECT fingerprint FROM library_catalog_seen WHERE origin_key = $key",
		)
		.get({ $key: originKey }) as { fingerprint: string } | undefined;
	return row?.fingerprint ?? null;
}

export function upsertCatalogSeen(
	originKey: string,
	fingerprint: string,
): void {
	const db = getLibraryDb();
	db.query(
		`INSERT INTO library_catalog_seen (origin_key, fingerprint, updated_at)
     VALUES ($key, $fingerprint, $updatedAt)
     ON CONFLICT(origin_key) DO UPDATE SET
       fingerprint = excluded.fingerprint,
       updated_at = excluded.updated_at`,
	).run({
		$key: originKey,
		$fingerprint: fingerprint,
		$updatedAt: nowIso(),
	});
}

export function listItemsNeedingEmbedding(modelId: string): LibraryItem[] {
	const db = getLibraryDb();
	const rows = db
		.query(
			`${ITEM_SELECT}
       WHERE i.status = 'ready'
         AND (e.item_id IS NULL OR e.model != $model)`,
		)
		.all({ $model: modelId }) as LibraryItemRow[];
	return rows.map(rowToItem);
}
