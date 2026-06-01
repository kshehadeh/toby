import { randomUUID } from "node:crypto";
import { ensureTobyDir, getMemoryDbPath } from "../config/index";
import type {
	MemoryAuditAction,
	MemoryAuditEntry,
	MemoryItem,
	MemoryProposal,
	MemoryProposalStatus,
	MemorySensitivity,
	MemorySource,
	MemorySourceSystem,
	MemoryVisibility,
} from "./types";

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

export function closeMemoryDbForTests(): void {
	if (dbSingleton) {
		dbSingleton.close();
		dbSingleton = null;
	}
}

export function getDb(): SqliteDb {
	if (dbSingleton) {
		return dbSingleton;
	}
	ensureTobyDir();
	// biome-ignore lint/suspicious/noExplicitAny: runtime-only dependency
	const bunSqlite = require("bun:sqlite") as any;
	const BunDatabase = bunSqlite.Database as new (path: string) => SqliteDb;
	const db = new BunDatabase(getMemoryDbPath());
	ensureSchema(db);
	dbSingleton = db;
	return db;
}

function ensureSchema(db: SqliteDb): void {
	db.exec(`
CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  subject TEXT,
  value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  sensitivity TEXT NOT NULL DEFAULT 'normal',
  visibility TEXT NOT NULL DEFAULT 'usable_by_ai',
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_items_user_type
  ON memory_items(user_id, type);

CREATE INDEX IF NOT EXISTS idx_memory_items_user_subject
  ON memory_items(user_id, subject);

CREATE TABLE IF NOT EXISTS memory_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  system TEXT NOT NULL,
  source_id TEXT,
  source_url TEXT,
  observed_at TEXT NOT NULL,
  excerpt TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS memory_item_sources (
  memory_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  PRIMARY KEY (memory_id, source_id),
  FOREIGN KEY (memory_id) REFERENCES memory_items(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES memory_sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_proposals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  candidate_json TEXT NOT NULL,
  source_id TEXT NOT NULL,
  confidence REAL NOT NULL,
  sensitivity TEXT NOT NULL,
  suggested_visibility TEXT NOT NULL,
  reason TEXT NOT NULL,
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (source_id) REFERENCES memory_sources(id)
);

CREATE INDEX IF NOT EXISTS idx_memory_proposals_user_status
  ON memory_proposals(user_id, status);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id TEXT PRIMARY KEY,
  embedding_blob BLOB NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memory_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  memory_id TEXT,
  action TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_audit_log_user
  ON memory_audit_log(user_id, created_at);
`);
}

function nowIso(): string {
	return new Date().toISOString();
}

// ── Memory items ──────────────────────────────────────────────────────

export function insertItem(
	userId: string,
	type: string,
	subject: string | undefined,
	value: string,
	confidence: number,
	sensitivity: MemorySensitivity,
	visibility: MemoryVisibility,
	expiresAt: string | null | undefined,
): MemoryItem {
	const db = getDb();
	const id = randomUUID();
	const ts = nowIso();
	db.query(
		`INSERT INTO memory_items (id, user_id, type, subject, value, confidence, sensitivity, visibility, expires_at, created_at, updated_at)
     VALUES ($id, $uid, $type, $subject, $value, $conf, $sens, $vis, $exp, $ca, $ua)`,
	).run({
		$id: id,
		$uid: userId,
		$type: type,
		$subject: subject ?? null,
		$value: value,
		$conf: confidence,
		$sens: sensitivity,
		$vis: visibility,
		$exp: expiresAt ?? null,
		$ca: ts,
		$ua: ts,
	});
	return {
		id,
		userId,
		type: type as MemoryItem["type"],
		subject: subject ?? undefined,
		value,
		confidence,
		sensitivity,
		visibility,
		sourceIds: [],
		createdAt: ts,
		updatedAt: ts,
		expiresAt: expiresAt ?? undefined,
	};
}

export function getItem(userId: string, memoryId: string): MemoryItem | null {
	const db = getDb();
	const row = db
		.query(
			`SELECT id, user_id, type, subject, value, confidence, sensitivity, visibility, expires_at, created_at, updated_at
       FROM memory_items WHERE id = $id AND user_id = $uid`,
		)
		.get({ $id: memoryId, $uid: userId }) as
		| {
				id: string;
				user_id: string;
				type: string;
				subject: string | null;
				value: string;
				confidence: number;
				sensitivity: string;
				visibility: string;
				expires_at: string | null;
				created_at: string;
				updated_at: string;
		  }
		| undefined;
	if (!row) return null;
	const sourceIds = getItemSourceIds(row.id);
	return {
		id: row.id,
		userId: row.user_id,
		type: row.type as MemoryItem["type"],
		subject: row.subject ?? undefined,
		value: row.value,
		confidence: row.confidence,
		sensitivity: row.sensitivity as MemorySensitivity,
		visibility: row.visibility as MemoryVisibility,
		sourceIds,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		expiresAt: row.expires_at ?? undefined,
	};
}

export function updateItem(
	userId: string,
	memoryId: string,
	patch: {
		value?: string;
		confidence?: number;
		sensitivity?: MemorySensitivity;
		visibility?: MemoryVisibility;
		subject?: string;
		expiresAt?: string | null;
	},
): MemoryItem | null {
	const db = getDb();
	const existing = getItem(userId, memoryId);
	if (!existing) return null;
	const ts = nowIso();
	const sets: string[] = ["updated_at = $ua"];
	const params: Record<string, unknown> = {
		$id: memoryId,
		$uid: userId,
		$ua: ts,
	};
	if (patch.value !== undefined) {
		sets.push("value = $value");
		params.$value = patch.value;
	}
	if (patch.confidence !== undefined) {
		sets.push("confidence = $conf");
		params.$conf = patch.confidence;
	}
	if (patch.sensitivity !== undefined) {
		sets.push("sensitivity = $sens");
		params.$sens = patch.sensitivity;
	}
	if (patch.visibility !== undefined) {
		sets.push("visibility = $vis");
		params.$vis = patch.visibility;
	}
	if (patch.subject !== undefined) {
		sets.push("subject = $subject");
		params.$subject = patch.subject;
	}
	if (patch.expiresAt !== undefined) {
		sets.push("expires_at = $exp");
		params.$exp = patch.expiresAt;
	}
	db.query(
		`UPDATE memory_items SET ${sets.join(", ")} WHERE id = $id AND user_id = $uid`,
	).run(params);
	return getItem(userId, memoryId);
}

export function deleteItem(userId: string, memoryId: string): boolean {
	const db = getDb();
	db.query("DELETE FROM memory_item_sources WHERE memory_id = $id").run({
		$id: memoryId,
	});
	const result = db
		.query("DELETE FROM memory_items WHERE id = $id AND user_id = $uid")
		.run({ $id: memoryId, $uid: userId });
	return Number((result as { changes: number } | null)?.changes ?? 0) > 0;
}

export function searchItems(userId: string, query: string): MemoryItem[] {
	const db = getDb();
	const pattern = `%${query}%`;
	const rows = db
		.query(
			`SELECT id, user_id, type, subject, value, confidence, sensitivity, visibility, expires_at, created_at, updated_at
       FROM memory_items
       WHERE user_id = $uid
         AND (value LIKE $pat OR subject LIKE $pat OR type LIKE $pat)
       ORDER BY updated_at DESC`,
		)
		.all({ $uid: userId, $pat: pattern }) as Array<{
		id: string;
		user_id: string;
		type: string;
		subject: string | null;
		value: string;
		confidence: number;
		sensitivity: string;
		visibility: string;
		expires_at: string | null;
		created_at: string;
		updated_at: string;
	}>;
	return rows.map((r) => ({
		id: r.id,
		userId: r.user_id,
		type: r.type as MemoryItem["type"],
		subject: r.subject ?? undefined,
		value: r.value,
		confidence: r.confidence,
		sensitivity: r.sensitivity as MemorySensitivity,
		visibility: r.visibility as MemoryVisibility,
		sourceIds: getItemSourceIds(r.id),
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		expiresAt: r.expires_at ?? undefined,
	}));
}

export function getItemsForRetrieval(
	userId: string,
	visibilities: string[],
	keywords: string[],
	maxItems: number,
): MemoryItem[] {
	const db = getDb();
	const visList = visibilities.map((_, i) => `$vis${i}`).join(",");
	const visParams: Record<string, unknown> = { $uid: userId };
	for (let i = 0; i < visibilities.length; i++) {
		visParams[`$vis${i}`] = visibilities[i];
	}

	if (keywords.length === 0) {
		const rows = db
			.query(
				`SELECT id, user_id, type, subject, value, confidence, sensitivity, visibility, expires_at, created_at, updated_at
         FROM memory_items
         WHERE user_id = $uid AND visibility IN (${visList})
         ORDER BY confidence DESC, updated_at DESC
         LIMIT $max`,
			)
			.all({ ...visParams, $max: maxItems }) as Array<{
			id: string;
			user_id: string;
			type: string;
			subject: string | null;
			value: string;
			confidence: number;
			sensitivity: string;
			visibility: string;
			expires_at: string | null;
			created_at: string;
			updated_at: string;
		}>;
		return rows.map(rowToItem);
	}

	const likeClauses = keywords.map(
		(_, i) => `(value LIKE $kw${i} OR subject LIKE $kw${i})`,
	);
	const kwParams: Record<string, unknown> = {};
	for (let i = 0; i < keywords.length; i++) {
		kwParams[`$kw${i}`] = `%${keywords[i]}%`;
	}
	const rows = db
		.query(
			`SELECT id, user_id, type, subject, value, confidence, sensitivity, visibility, expires_at, created_at, updated_at
       FROM memory_items
       WHERE user_id = $uid
         AND visibility IN (${visList})
         AND (${likeClauses.join(" OR ")})
       ORDER BY confidence DESC, updated_at DESC
       LIMIT $max`,
		)
		.all({ ...visParams, ...kwParams, $max: maxItems }) as Array<{
		id: string;
		user_id: string;
		type: string;
		subject: string | null;
		value: string;
		confidence: number;
		sensitivity: string;
		visibility: string;
		expires_at: string | null;
		created_at: string;
		updated_at: string;
	}>;
	return rows.map(rowToItem);
}

function rowToItem(r: {
	id: string;
	user_id: string;
	type: string;
	subject: string | null;
	value: string;
	confidence: number;
	sensitivity: string;
	visibility: string;
	expires_at: string | null;
	created_at: string;
	updated_at: string;
}): MemoryItem {
	return {
		id: r.id,
		userId: r.user_id,
		type: r.type as MemoryItem["type"],
		subject: r.subject ?? undefined,
		value: r.value,
		confidence: r.confidence,
		sensitivity: r.sensitivity as MemorySensitivity,
		visibility: r.visibility as MemoryVisibility,
		sourceIds: getItemSourceIds(r.id),
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		expiresAt: r.expires_at ?? undefined,
	};
}

// ── Sources ───────────────────────────────────────────────────────────

export function insertSource(
	userId: string,
	system: MemorySourceSystem,
	sourceId: string | undefined,
	sourceUrl: string | undefined,
	observedAt: string,
	excerpt: string | undefined,
	metadata: Record<string, unknown> | undefined,
): MemorySource {
	const db = getDb();
	const id = randomUUID();
	db.query(
		`INSERT INTO memory_sources (id, user_id, system, source_id, source_url, observed_at, excerpt, metadata_json)
     VALUES ($id, $uid, $sys, $sid, $url, $oa, $exc, $mj)`,
	).run({
		$id: id,
		$uid: userId,
		$sys: system,
		$sid: sourceId ?? null,
		$url: sourceUrl ?? null,
		$oa: observedAt,
		$exc: excerpt ?? null,
		$mj: metadata ? JSON.stringify(metadata) : null,
	});
	return {
		id,
		userId,
		system,
		sourceId,
		sourceUrl,
		observedAt,
		excerpt,
		metadata,
	};
}

export function getSource(sourceId: string): MemorySource | null {
	const db = getDb();
	const row = db
		.query(
			`SELECT id, user_id, system, source_id, source_url, observed_at, excerpt, metadata_json
       FROM memory_sources WHERE id = $id`,
		)
		.get({ $id: sourceId }) as
		| {
				id: string;
				user_id: string;
				system: string;
				source_id: string | null;
				source_url: string | null;
				observed_at: string;
				excerpt: string | null;
				metadata_json: string | null;
		  }
		| undefined;
	if (!row) return null;
	return {
		id: row.id,
		userId: row.user_id,
		system: row.system as MemorySourceSystem,
		sourceId: row.source_id ?? undefined,
		sourceUrl: row.source_url ?? undefined,
		observedAt: row.observed_at,
		excerpt: row.excerpt ?? undefined,
		metadata: row.metadata_json
			? (JSON.parse(row.metadata_json) as Record<string, unknown>)
			: undefined,
	};
}

export function getItemSourceIds(memoryId: string): string[] {
	const db = getDb();
	const rows = db
		.query("SELECT source_id FROM memory_item_sources WHERE memory_id = $mid")
		.all({ $mid: memoryId }) as Array<{ source_id: string }>;
	return rows.map((r) => r.source_id);
}

export function getSourcesForItem(memoryId: string): MemorySource[] {
	const ids = getItemSourceIds(memoryId);
	return ids
		.map((id) => getSource(id))
		.filter((s): s is MemorySource => s !== null);
}

export function linkItemSource(memoryId: string, sourceId: string): void {
	const db = getDb();
	db.query(
		"INSERT OR IGNORE INTO memory_item_sources (memory_id, source_id) VALUES ($mid, $sid)",
	).run({ $mid: memoryId, $sid: sourceId });
}

// ── Proposals ─────────────────────────────────────────────────────────

export function insertProposal(
	userId: string,
	candidateJson: string,
	sourceId: string,
	confidence: number,
	sensitivity: MemorySensitivity,
	suggestedVisibility: MemoryVisibility,
	reason: string,
): MemoryProposal {
	const db = getDb();
	const id = randomUUID();
	const ts = nowIso();
	db.query(
		`INSERT INTO memory_proposals (id, user_id, status, candidate_json, source_id, confidence, sensitivity, suggested_visibility, reason, created_at)
     VALUES ($id, $uid, $status, $cj, $sid, $conf, $sens, $vis, $reason, $ca)`,
	).run({
		$id: id,
		$uid: userId,
		$status: "pending",
		$cj: candidateJson,
		$sid: sourceId,
		$conf: confidence,
		$sens: sensitivity,
		$vis: suggestedVisibility,
		$reason: reason,
		$ca: ts,
	});
	return {
		id,
		userId,
		status: "pending",
		candidate: JSON.parse(candidateJson) as MemoryProposal["candidate"],
		sourceId,
		confidence,
		sensitivity,
		suggestedVisibility,
		reason,
		createdAt: ts,
	};
}

export function getProposal(
	userId: string,
	proposalId: string,
): MemoryProposal | null {
	const db = getDb();
	const row = db
		.query(
			`SELECT id, user_id, status, candidate_json, source_id, confidence, sensitivity, suggested_visibility, reason, rejection_reason, created_at, resolved_at
       FROM memory_proposals WHERE id = $id AND user_id = $uid`,
		)
		.get({ $id: proposalId, $uid: userId }) as
		| {
				id: string;
				user_id: string;
				status: string;
				candidate_json: string;
				source_id: string;
				confidence: number;
				sensitivity: string;
				suggested_visibility: string;
				reason: string;
				rejection_reason: string | null;
				created_at: string;
				resolved_at: string | null;
		  }
		| undefined;
	if (!row) return null;
	return {
		id: row.id,
		userId: row.user_id,
		status: row.status as MemoryProposalStatus,
		candidate: JSON.parse(row.candidate_json) as MemoryProposal["candidate"],
		sourceId: row.source_id,
		confidence: row.confidence,
		sensitivity: row.sensitivity as MemorySensitivity,
		suggestedVisibility: row.suggested_visibility as MemoryVisibility,
		reason: row.reason,
		rejectionReason: row.rejection_reason ?? undefined,
		createdAt: row.created_at,
		resolvedAt: row.resolved_at ?? undefined,
	};
}

export function updateProposalStatus(
	userId: string,
	proposalId: string,
	status: MemoryProposalStatus,
	rejectionReason?: string,
): void {
	const db = getDb();
	const ts = nowIso();
	db.query(
		`UPDATE memory_proposals SET status = $status, rejection_reason = $rr, resolved_at = $ra
     WHERE id = $id AND user_id = $uid`,
	).run({
		$id: proposalId,
		$uid: userId,
		$status: status,
		$rr: rejectionReason ?? null,
		$ra: ts,
	});
}

// ── Audit log ─────────────────────────────────────────────────────────

export function insertAuditEntry(
	userId: string,
	memoryId: string | undefined,
	action: MemoryAuditAction,
	detail?: Record<string, unknown>,
): void {
	const db = getDb();
	const id = randomUUID();
	db.query(
		`INSERT INTO memory_audit_log (id, user_id, memory_id, action, detail_json, created_at)
     VALUES ($id, $uid, $mid, $action, $dj, $ca)`,
	).run({
		$id: id,
		$uid: userId,
		$mid: memoryId ?? null,
		$action: action,
		$dj: detail ? JSON.stringify(detail) : null,
		$ca: nowIso(),
	});
}

export function getAuditEntriesForMemory(memoryId: string): MemoryAuditEntry[] {
	const db = getDb();
	const rows = db
		.query(
			`SELECT id, user_id, memory_id, action, detail_json, created_at
       FROM memory_audit_log WHERE memory_id = $mid ORDER BY created_at ASC`,
		)
		.all({ $mid: memoryId }) as Array<{
		id: string;
		user_id: string;
		memory_id: string | null;
		action: string;
		detail_json: string | null;
		created_at: string;
	}>;
	return rows.map((r) => ({
		id: r.id,
		userId: r.user_id,
		memoryId: r.memory_id ?? undefined,
		action: r.action as MemoryAuditAction,
		detail: r.detail_json
			? (JSON.parse(r.detail_json) as Record<string, unknown>)
			: undefined,
		createdAt: r.created_at,
	}));
}

// ── Embeddings (stub-ready) ───────────────────────────────────────────

export function insertEmbedding(
	memoryId: string,
	embeddingBlob: Buffer,
	model: string,
): void {
	const db = getDb();
	db.query(
		`INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding_blob, model, created_at)
     VALUES ($mid, $blob, $model, $ca)`,
	).run({
		$mid: memoryId,
		$blob: embeddingBlob,
		$model: model,
		$ca: nowIso(),
	});
}

export function getEmbedding(
	memoryId: string,
): { blob: Buffer; model: string } | null {
	const db = getDb();
	const row = db
		.query(
			"SELECT embedding_blob, model FROM memory_embeddings WHERE memory_id = $mid",
		)
		.get({ $mid: memoryId }) as
		| { embedding_blob: Buffer; model: string }
		| undefined;
	if (!row) return null;
	return { blob: row.embedding_blob, model: row.model };
}
