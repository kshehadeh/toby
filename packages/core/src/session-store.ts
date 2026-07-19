import { randomUUID } from "node:crypto";
import type { CoreMessage } from "./ai/chat";
import type { AIContextWindowInfo } from "./ai/context-window";
import type { UserIntentSpec } from "./ai/pretreatment";
import type { ChatSessionSettings } from "./api/chat-api";
import type { TranscriptEntry } from "./chat-pipeline/transcript-types";
import { ensureTobyDir, getChatDbPath } from "./config/index";
import {
	deserializeTranscriptRow,
	serializeTranscriptEntry,
} from "./transcript-persist";

export type ChatSessionSummary = {
	readonly id: string;
	readonly name: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly projectId?: string | null;
	readonly sourceIntegration?: string | null;
	readonly sourceDisplayName?: string | null;
	readonly externalKey?: string | null;
	readonly lifecycleStatus?: SessionLifecycleStatus | null;
	readonly lastRemoteMessageAt?: string | null;
};

type LoadedChatSession = {
	readonly id: string;
	readonly name: string;
	readonly messages: CoreMessage[];
	readonly transcript: TranscriptEntry[];
	readonly settings: ChatSessionSettings;
	readonly contextWindow?: AIContextWindowInfo;
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

export type { SqliteDb };

export function closeChatDbForTests(): void {
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
  project_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  folder_path TEXT NOT NULL,
  persona_name TEXT,
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

CREATE TABLE IF NOT EXISTS chat_pretreatment_cache (
  prompt_key TEXT PRIMARY KEY,
  spec_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_hit_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at
  ON chat_sessions(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_pretreatment_cache_last_hit_at
  ON chat_pretreatment_cache(last_hit_at DESC);

CREATE TABLE IF NOT EXISTS routing_embeddings (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  catalog_signature TEXT NOT NULL,
  model TEXT NOT NULL,
  embedding_blob BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id, catalog_signature, model)
);

CREATE INDEX IF NOT EXISTS idx_routing_embeddings_catalog
  ON routing_embeddings(catalog_signature, model);

CREATE TABLE IF NOT EXISTS chat_plans (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_plan_phases (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  phase_order INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES chat_plans(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_plans_session_id
  ON chat_plans(session_id);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  persona_name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  project_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS schedule_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  persona_name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  output TEXT,
  transcript TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule_id
  ON schedule_runs(schedule_id);

CREATE INDEX IF NOT EXISTS idx_schedule_runs_started_at
  ON schedule_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS flow_runs (
  id TEXT PRIMARY KEY,
  flow_name TEXT NOT NULL,
  status TEXT NOT NULL,
  persona_name TEXT,
  provider TEXT,
  model TEXT,
  trigger TEXT,
  definition_snapshot_json TEXT NOT NULL,
  initial_inputs_json TEXT,
  final_outputs_json TEXT,
  error TEXT,
  failed_node_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_flow_runs_started_at
  ON flow_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_flow_runs_flow_name_started_at
  ON flow_runs(flow_name, started_at DESC);

CREATE TABLE IF NOT EXISTS flow_run_nodes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  node_order INTEGER NOT NULL,
  status TEXT NOT NULL,
  inputs_json TEXT,
  outputs_json TEXT,
  error TEXT,
  duration_ms INTEGER,
  started_at TEXT,
  completed_at TEXT,
  detail_json TEXT,
  FOREIGN KEY (run_id) REFERENCES flow_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_flow_run_nodes_run_id_order
  ON flow_run_nodes(run_id, node_order);

CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  persona_json TEXT,
  definition_json TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flows_name ON flows(name);

CREATE TABLE IF NOT EXISTS chat_external_sessions (
  integration TEXT NOT NULL,
  external_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  display_name TEXT,
  metadata_json TEXT,
  awaiting_ask_user_json TEXT,
  last_processed_message_id TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'idle',
  active_since TEXT,
  ended_at TEXT,
  last_remote_message_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (integration, external_key),
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_external_sessions_session_id
  ON chat_external_sessions(session_id);
`);
	migrateChatSessionsSchema(db);
	migrateChatExternalSessionsSchema(db);
	migrateScheduleRunsSchema(db);
	migrateSchedulesSchema(db);
	db.exec(`
CREATE INDEX IF NOT EXISTS idx_chat_sessions_project_id
  ON chat_sessions(project_id);

CREATE INDEX IF NOT EXISTS idx_schedules_project_id
  ON schedules(project_id);
`);
}

function migrateChatSessionsSchema(db: SqliteDb): void {
	const cols = db.query("PRAGMA table_info(chat_sessions)").all() as Array<{
		name: string;
	}>;
	if (!cols.some((c) => c.name === "last_pretreatment_json")) {
		db.exec("ALTER TABLE chat_sessions ADD COLUMN last_pretreatment_json TEXT");
	}
	if (!cols.some((c) => c.name === "settings_json")) {
		db.exec("ALTER TABLE chat_sessions ADD COLUMN settings_json TEXT");
	}
	if (!cols.some((c) => c.name === "context_window_json")) {
		db.exec("ALTER TABLE chat_sessions ADD COLUMN context_window_json TEXT");
	}
	if (!cols.some((c) => c.name === "project_id")) {
		db.exec("ALTER TABLE chat_sessions ADD COLUMN project_id TEXT");
	}
}

function ensureChatSessionContextWindowColumn(db: SqliteDb): void {
	const cols = db.query("PRAGMA table_info(chat_sessions)").all() as Array<{
		name: string;
	}>;
	if (!cols.some((c) => c.name === "context_window_json")) {
		db.exec("ALTER TABLE chat_sessions ADD COLUMN context_window_json TEXT");
	}
}

function migrateChatExternalSessionsSchema(db: SqliteDb): void {
	const cols = db
		.query("PRAGMA table_info(chat_external_sessions)")
		.all() as Array<{
		name: string;
	}>;
	if (!cols.some((c) => c.name === "lifecycle_status")) {
		db.exec(
			"ALTER TABLE chat_external_sessions ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'idle'",
		);
	}
	if (!cols.some((c) => c.name === "active_since")) {
		db.exec("ALTER TABLE chat_external_sessions ADD COLUMN active_since TEXT");
	}
	if (!cols.some((c) => c.name === "ended_at")) {
		db.exec("ALTER TABLE chat_external_sessions ADD COLUMN ended_at TEXT");
	}
	if (!cols.some((c) => c.name === "last_remote_message_at")) {
		db.exec(
			"ALTER TABLE chat_external_sessions ADD COLUMN last_remote_message_at TEXT",
		);
	}
}

function migrateScheduleRunsSchema(db: SqliteDb): void {
	const cols = db.query("PRAGMA table_info(schedule_runs)").all() as Array<{
		name: string;
	}>;
	if (!cols.some((c) => c.name === "transcript")) {
		db.exec("ALTER TABLE schedule_runs ADD COLUMN transcript TEXT");
	}
}

function migrateSchedulesSchema(db: SqliteDb): void {
	const cols = db.query("PRAGMA table_info(schedules)").all() as Array<{
		name: string;
	}>;
	if (!cols.some((c) => c.name === "project_id")) {
		db.exec("ALTER TABLE schedules ADD COLUMN project_id TEXT");
	}
}

export function parseSessionSettingsJson(
	raw: string | null | undefined,
): ChatSessionSettings {
	if (!raw?.trim()) {
		return {};
	}
	try {
		const parsed = JSON.parse(raw) as ChatSessionSettings;
		return {
			...(parsed.persona ? { persona: String(parsed.persona) } : {}),
			...(Array.isArray(parsed.modules)
				? { modules: parsed.modules.map(String) }
				: {}),
			...(parsed.dryRun !== undefined
				? { dryRun: Boolean(parsed.dryRun) }
				: {}),
			...(parsed.debug !== undefined ? { debug: Boolean(parsed.debug) } : {}),
			...(parsed.projectId ? { projectId: String(parsed.projectId) } : {}),
		};
	} catch {
		return {};
	}
}

export function getSessionSettings(sessionId: string): ChatSessionSettings {
	const id = sessionId.trim();
	if (!id) return {};
	const db = getDb();
	const row = db
		.query(
			"SELECT settings_json as settingsJson, project_id as projectId FROM chat_sessions WHERE id = $id",
		)
		.get({ $id: id }) as
		| { settingsJson: string | null; projectId: string | null }
		| undefined;
	const settings = parseSessionSettingsJson(row?.settingsJson);
	return {
		...settings,
		...(row?.projectId ? { projectId: row.projectId } : {}),
	};
}

export function setSessionSettings(
	sessionId: string,
	settings: ChatSessionSettings,
): void {
	const id = sessionId.trim();
	if (!id) return;
	const db = getDb();
	db.query(
		"UPDATE chat_sessions SET settings_json = $json, project_id = $project_id, updated_at = $updated_at WHERE id = $id",
	).run({
		$id: id,
		$json: JSON.stringify(settings),
		$project_id: settings.projectId?.trim() || null,
		$updated_at: nowIso(),
	});
}

export function mergeSessionSettings(
	sessionId: string,
	patch: Partial<ChatSessionSettings>,
): ChatSessionSettings {
	const current = getSessionSettings(sessionId);
	const next: ChatSessionSettings = {
		...current,
		...(patch.persona !== undefined ? { persona: patch.persona } : {}),
		...(patch.modules !== undefined ? { modules: [...patch.modules] } : {}),
		...(patch.dryRun !== undefined ? { dryRun: patch.dryRun } : {}),
		...(patch.debug !== undefined ? { debug: patch.debug } : {}),
		...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
	};
	setSessionSettings(sessionId, next);
	return next;
}

export function deleteChatSession(sessionId: string): boolean {
	const id = sessionId.trim();
	if (!id) return false;
	const db = getDb();
	const existing = db
		.query("SELECT id FROM chat_sessions WHERE id = $id")
		.get({ $id: id });
	if (!existing) return false;
	const tx = db.transaction(() => {
		db.query("DELETE FROM chat_session_messages WHERE session_id = $id").run({
			$id: id,
		});
		db.query("DELETE FROM chat_session_transcript WHERE session_id = $id").run({
			$id: id,
		});
		db.query("DELETE FROM chat_plans WHERE session_id = $id").run({ $id: id });
		db.query("DELETE FROM chat_external_sessions WHERE session_id = $id").run({
			$id: id,
		});
		db.query("DELETE FROM chat_sessions WHERE id = $id").run({ $id: id });
	});
	tx();
	return true;
}

export type LastPretreatmentRecord = {
	readonly rawUserText: string;
	readonly spec: UserIntentSpec;
};

export function getSessionLastPretreatment(
	sessionId: string,
): LastPretreatmentRecord | null {
	const id = sessionId.trim();
	if (!id) return null;
	const db = getDb();
	const row = db
		.query(
			`SELECT last_pretreatment_json as lastPretreatmentJson
       FROM chat_sessions WHERE id = $id`,
		)
		.get({ $id: id }) as { lastPretreatmentJson: string | null } | undefined;
	if (!row?.lastPretreatmentJson) return null;
	try {
		const parsed = JSON.parse(row.lastPretreatmentJson) as {
			rawUserText?: string;
			spec?: UserIntentSpec;
		};
		if (
			typeof parsed.rawUserText !== "string" ||
			!parsed.spec ||
			typeof parsed.spec !== "object"
		) {
			return null;
		}
		return { rawUserText: parsed.rawUserText, spec: parsed.spec };
	} catch {
		return null;
	}
}

export function setSessionLastPretreatment(
	sessionId: string,
	record: LastPretreatmentRecord,
): void {
	const id = sessionId.trim();
	if (!id) return;
	const db = getDb();
	db.query(
		`UPDATE chat_sessions
     SET last_pretreatment_json = $json, updated_at = $updated_at
     WHERE id = $id`,
	).run({
		$id: id,
		$json: JSON.stringify(record),
		$updated_at: nowIso(),
	});
}

function parseContextWindowJson(
	raw: string | null | undefined,
): AIContextWindowInfo | undefined {
	if (!raw?.trim()) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (parsed.supported === true) {
			const contextWindowTokens = Number(parsed.contextWindowTokens);
			if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) {
				return undefined;
			}
			const fillPercentage =
				typeof parsed.fillPercentage === "number" &&
				Number.isFinite(parsed.fillPercentage)
					? Math.max(0, Math.min(100, Math.round(parsed.fillPercentage)))
					: undefined;
			return {
				supported: true,
				contextWindowTokens,
				...(fillPercentage !== undefined ? { fillPercentage } : {}),
			};
		}
		if (parsed.supported === false) {
			return {
				supported: false,
				unavailableReason:
					typeof parsed.unavailableReason === "string" &&
					parsed.unavailableReason.trim()
						? parsed.unavailableReason
						: "Provider doesn't support context window information.",
			};
		}
		return undefined;
	} catch {
		return undefined;
	}
}

export function setSessionContextWindow(
	sessionId: string,
	contextWindow: AIContextWindowInfo | undefined,
): void {
	const id = sessionId.trim();
	if (!id) return;
	if (!contextWindow) return;
	const db = getDb();
	ensureChatSessionContextWindowColumn(db);
	const existing = db
		.query(
			"SELECT context_window_json as contextWindowJson FROM chat_sessions WHERE id = $id",
		)
		.get({ $id: id }) as { contextWindowJson: string | null } | undefined;
	const existingContextWindow = parseContextWindowJson(
		existing?.contextWindowJson,
	);
	const nextContextWindow =
		contextWindow.supported &&
		contextWindow.fillPercentage === undefined &&
		existingContextWindow?.supported === true &&
		existingContextWindow.fillPercentage !== undefined
			? {
					supported: true as const,
					contextWindowTokens: contextWindow.contextWindowTokens,
					fillPercentage: existingContextWindow.fillPercentage,
				}
			: contextWindow;
	db.query(
		`UPDATE chat_sessions
     SET context_window_json = $json
     WHERE id = $id`,
	).run({
		$id: id,
		$json: JSON.stringify(nextContextWindow),
	});
}

export type SessionLifecycleStatus =
	| "idle"
	| "running"
	| "awaiting_user"
	| "ended"
	| "error";

export type ExternalSessionRecord = {
	readonly integration: string;
	readonly externalKey: string;
	readonly sessionId: string;
	readonly displayName: string | null;
	readonly metadata: Record<string, unknown>;
	readonly awaitingAskUser: PendingAskUser | null;
	readonly lastProcessedMessageId: string | null;
	readonly lifecycleStatus: SessionLifecycleStatus;
	readonly activeSince: string | null;
	readonly endedAt: string | null;
	readonly lastRemoteMessageAt: string | null;
};

export type PendingAskUser = {
	readonly question: string;
	readonly options: readonly string[];
	readonly createdAt: string;
};

export function getOrCreateExternalSession(params: {
	readonly integration: string;
	readonly externalKey: string;
	readonly displayName: string;
	readonly metadata: Record<string, unknown>;
}): ExternalSessionRecord {
	const db = getDb();
	const existing = loadExternalSession(params.integration, params.externalKey);
	if (existing) {
		// Verify the referenced chat_sessions row still exists. If it was
		// deleted (e.g. user removed the session from the app), create a new
		// session row and update the mapping so future messages are visible.
		const sessionRow = db
			.query("SELECT id FROM chat_sessions WHERE id = $id")
			.get({ $id: existing.sessionId }) as { id: string } | undefined;
		if (sessionRow) {
			return existing;
		}
		const replacement = createChatSession({
			name: existing.displayName ?? params.displayName,
		});
		const ts = nowIso();
		db.query(
			`UPDATE chat_external_sessions
       SET session_id = $session_id, display_name = $display_name,
           lifecycle_status = 'running', active_since = $active_since,
           ended_at = NULL, last_remote_message_at = $active_since,
           updated_at = $updated_at
     WHERE integration = $integration AND external_key = $external_key`,
		).run({
			$integration: params.integration,
			$external_key: params.externalKey,
			$session_id: replacement.id,
			$display_name: params.displayName,
			$active_since: ts,
			$updated_at: ts,
		});
		return {
			integration: params.integration,
			externalKey: params.externalKey,
			sessionId: replacement.id,
			displayName: params.displayName,
			metadata: existing.metadata,
			awaitingAskUser: existing.awaitingAskUser,
			lastProcessedMessageId: existing.lastProcessedMessageId,
			lifecycleStatus: "running",
			activeSince: ts,
			endedAt: null,
			lastRemoteMessageAt: ts,
		};
	}
	const session = createChatSession({ name: params.displayName });
	const ts = nowIso();
	const metadataJson = JSON.stringify(params.metadata);
	db.query(
		`INSERT INTO chat_external_sessions (
       integration, external_key, session_id, display_name, metadata_json,
       awaiting_ask_user_json, last_processed_message_id,
       lifecycle_status, active_since, ended_at, last_remote_message_at,
       created_at, updated_at
     ) VALUES (
       $integration, $external_key, $session_id, $display_name, $metadata_json,
       NULL, NULL,
       'running', $active_since, NULL, $active_since,
       $created_at, $updated_at
     )`,
	).run({
		$integration: params.integration,
		$external_key: params.externalKey,
		$session_id: session.id,
		$display_name: params.displayName,
		$metadata_json: metadataJson,
		$active_since: ts,
		$created_at: ts,
		$updated_at: ts,
	});
	return {
		integration: params.integration,
		externalKey: params.externalKey,
		sessionId: session.id,
		displayName: params.displayName,
		metadata: params.metadata,
		awaitingAskUser: null,
		lastProcessedMessageId: null,
		lifecycleStatus: "running",
		activeSince: ts,
		endedAt: null,
		lastRemoteMessageAt: ts,
	};
}

function parseExternalSessionRow(row: {
	integration: string;
	externalKey: string;
	sessionId: string;
	displayName: string | null;
	metadataJson: string | null;
	awaitingAskUserJson: string | null;
	lastProcessedMessageId: string | null;
	lifecycleStatus: string | null;
	activeSince: string | null;
	endedAt: string | null;
	lastRemoteMessageAt: string | null;
}): ExternalSessionRecord {
	let metadata: Record<string, unknown> = {};
	if (row.metadataJson) {
		try {
			metadata = JSON.parse(row.metadataJson) as Record<string, unknown>;
		} catch {
			metadata = {};
		}
	}
	let awaitingAskUser: PendingAskUser | null = null;
	if (row.awaitingAskUserJson) {
		try {
			awaitingAskUser = JSON.parse(row.awaitingAskUserJson) as PendingAskUser;
		} catch {
			awaitingAskUser = null;
		}
	}
	const lifecycleStatus = (row.lifecycleStatus ??
		"idle") as SessionLifecycleStatus;
	return {
		integration: row.integration,
		externalKey: row.externalKey,
		sessionId: row.sessionId,
		displayName: row.displayName,
		metadata,
		awaitingAskUser,
		lastProcessedMessageId: row.lastProcessedMessageId,
		lifecycleStatus,
		activeSince: row.activeSince,
		endedAt: row.endedAt,
		lastRemoteMessageAt: row.lastRemoteMessageAt,
	};
}

export function loadExternalSession(
	integration: string,
	externalKey: string,
): ExternalSessionRecord | null {
	const db = getDb();
	const row = db
		.query(
			`SELECT integration, external_key as externalKey, session_id as sessionId,
              display_name as displayName, metadata_json as metadataJson,
              awaiting_ask_user_json as awaitingAskUserJson,
              last_processed_message_id as lastProcessedMessageId,
              lifecycle_status as lifecycleStatus, active_since as activeSince,
              ended_at as endedAt, last_remote_message_at as lastRemoteMessageAt
       FROM chat_external_sessions
       WHERE integration = $integration AND external_key = $external_key`,
		)
		.get({ $integration: integration, $external_key: externalKey }) as
		| {
				integration: string;
				externalKey: string;
				sessionId: string;
				displayName: string | null;
				metadataJson: string | null;
				awaitingAskUserJson: string | null;
				lastProcessedMessageId: string | null;
				lifecycleStatus: string | null;
				activeSince: string | null;
				endedAt: string | null;
				lastRemoteMessageAt: string | null;
		  }
		| undefined;
	if (!row) return null;
	return parseExternalSessionRow(row);
}

export function loadExternalSessionBySessionId(
	sessionId: string,
): ExternalSessionRecord | null {
	const db = getDb();
	const row = db
		.query(
			`SELECT integration, external_key as externalKey, session_id as sessionId,
              display_name as displayName, metadata_json as metadataJson,
              awaiting_ask_user_json as awaitingAskUserJson,
              last_processed_message_id as lastProcessedMessageId,
              lifecycle_status as lifecycleStatus, active_since as activeSince,
              ended_at as endedAt, last_remote_message_at as lastRemoteMessageAt
       FROM chat_external_sessions
       WHERE session_id = $session_id`,
		)
		.get({ $session_id: sessionId }) as
		| {
				integration: string;
				externalKey: string;
				sessionId: string;
				displayName: string | null;
				metadataJson: string | null;
				awaitingAskUserJson: string | null;
				lastProcessedMessageId: string | null;
				lifecycleStatus: string | null;
				activeSince: string | null;
				endedAt: string | null;
				lastRemoteMessageAt: string | null;
		  }
		| undefined;
	if (!row) return null;
	return parseExternalSessionRow(row);
}

/**
 * Lists all persisted external session mappings for an integration.
 * Used to seed plugin inbound providers with known sessions and pending
 * askUser state so that channel thread follow-ups survive daemon restarts.
 */
export function listExternalSessionsForIntegration(
	integration: string,
): readonly ExternalSessionRecord[] {
	const db = getDb();
	const rows = db
		.query(
			`SELECT integration, external_key as externalKey, session_id as sessionId,
              display_name as displayName, metadata_json as metadataJson,
              awaiting_ask_user_json as awaitingAskUserJson,
              last_processed_message_id as lastProcessedMessageId,
              lifecycle_status as lifecycleStatus, active_since as activeSince,
              ended_at as endedAt, last_remote_message_at as lastRemoteMessageAt
       FROM chat_external_sessions
       WHERE integration = $integration`,
		)
		.all({ $integration: integration }) as readonly {
		integration: string;
		externalKey: string;
		sessionId: string;
		displayName: string | null;
		metadataJson: string | null;
		awaitingAskUserJson: string | null;
		lastProcessedMessageId: string | null;
		lifecycleStatus: string | null;
		activeSince: string | null;
		endedAt: string | null;
		lastRemoteMessageAt: string | null;
	}[];
	return rows.map((row) => parseExternalSessionRow(row));
}

export function updateExternalSessionMetadata(
	integration: string,
	externalKey: string,
	metadata: Record<string, unknown>,
): void {
	const db = getDb();
	db.query(
		`UPDATE chat_external_sessions
     SET metadata_json = $metadata_json, updated_at = $updated_at
     WHERE integration = $integration AND external_key = $external_key`,
	).run({
		$integration: integration,
		$external_key: externalKey,
		$metadata_json: JSON.stringify(metadata),
		$updated_at: nowIso(),
	});
}

export function setPendingAskUser(
	integration: string,
	externalKey: string,
	pending: PendingAskUser,
): void {
	const db = getDb();
	const ts = nowIso();
	db.query(
		`UPDATE chat_external_sessions
     SET awaiting_ask_user_json = $json,
         lifecycle_status = 'awaiting_user',
         updated_at = $updated_at
     WHERE integration = $integration AND external_key = $external_key`,
	).run({
		$integration: integration,
		$external_key: externalKey,
		$json: JSON.stringify(pending),
		$updated_at: ts,
	});
}

export function clearPendingAskUser(
	integration: string,
	externalKey: string,
): void {
	const db = getDb();
	db.query(
		`UPDATE chat_external_sessions
     SET awaiting_ask_user_json = NULL,
         lifecycle_status = 'idle',
         updated_at = $updated_at
     WHERE integration = $integration AND external_key = $external_key`,
	).run({
		$integration: integration,
		$external_key: externalKey,
		$updated_at: nowIso(),
	});
}

export function setSessionLifecycleStatus(
	integration: string,
	externalKey: string,
	status: SessionLifecycleStatus,
): void {
	const db = getDb();
	const ts = nowIso();
	const activeSince =
		status === "running" ? ts : status === "idle" ? null : undefined;
	const endedAt = status === "ended" || status === "idle" ? ts : undefined;
	const sets: string[] = [
		"lifecycle_status = $status",
		"updated_at = $updated_at",
	];
	if (activeSince !== undefined) {
		sets.push("active_since = $active_since");
	}
	if (endedAt !== undefined) {
		sets.push("ended_at = $ended_at");
	}
	db.query(
		`UPDATE chat_external_sessions SET ${sets.join(", ")}
     WHERE integration = $integration AND external_key = $external_key`,
	).run({
		$integration: integration,
		$external_key: externalKey,
		$status: status,
		$updated_at: ts,
		...(activeSince !== undefined ? { $active_since: activeSince } : {}),
		...(endedAt !== undefined ? { $ended_at: endedAt } : {}),
	});
}

export function markMessageProcessed(
	integration: string,
	externalKey: string,
	messageId: string,
): void {
	const db = getDb();
	const ts = nowIso();
	db.query(
		`UPDATE chat_external_sessions
     SET last_processed_message_id = $message_id,
         last_remote_message_at = $ts,
         updated_at = $updated_at
     WHERE integration = $integration AND external_key = $external_key`,
	).run({
		$integration: integration,
		$external_key: externalKey,
		$message_id: messageId,
		$ts: ts,
		$updated_at: ts,
	});
}

export function wasMessageProcessed(
	integration: string,
	externalKey: string,
	messageId: string,
): boolean {
	const row = loadExternalSession(integration, externalKey);
	return row?.lastProcessedMessageId === messageId;
}

function nowIso(): string {
	return new Date().toISOString();
}

export function createChatSession(params?: {
	readonly name?: string;
	readonly settings?: ChatSessionSettings;
}): ChatSessionSummary {
	const db = getDb();
	const id = randomUUID();
	const ts = nowIso();
	const name = params?.name?.trim() || "New chat";
	const settingsJson = params?.settings
		? JSON.stringify(params.settings)
		: null;
	db.query(
		`INSERT INTO chat_sessions (id, name, project_id, created_at, updated_at, settings_json)
     VALUES ($id, $name, $project_id, $created_at, $updated_at, $settings_json)`,
	).run({
		$id: id,
		$name: name,
		$project_id: params?.settings?.projectId?.trim() || null,
		$created_at: ts,
		$updated_at: ts,
		$settings_json: settingsJson,
	});
	return {
		id,
		name,
		createdAt: ts,
		updatedAt: ts,
		projectId: params?.settings?.projectId ?? null,
	};
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

/** Max sessions shown in the `/sessions` picker (most recently updated first). */
export const CHAT_SESSION_PICKER_LIMIT = 10;

export function listChatSessions(limit = 50): ChatSessionSummary[] {
	const db = getDb();
	const rows = db
		.query(
			`SELECT s.id, s.name, s.project_id as projectId, s.created_at as createdAt, s.updated_at as updatedAt,
              es.integration as sourceIntegration,
              es.display_name as sourceDisplayName,
              es.external_key as externalKey,
              es.lifecycle_status as lifecycleStatus,
              es.last_remote_message_at as lastRemoteMessageAt
       FROM chat_sessions s
       LEFT JOIN chat_external_sessions es ON es.session_id = s.id
       WHERE s.project_id IS NULL
       ORDER BY s.updated_at DESC
       LIMIT $limit`,
		)
		.all({ $limit: Math.max(1, Math.min(500, limit)) }) as Array<{
		id: string;
		name: string;
		createdAt: string;
		updatedAt: string;
		projectId: string | null;
		sourceIntegration: string | null;
		sourceDisplayName: string | null;
		externalKey: string | null;
		lifecycleStatus: string | null;
		lastRemoteMessageAt: string | null;
	}>;
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
		projectId: r.projectId,
		sourceIntegration: r.sourceIntegration,
		sourceDisplayName: r.sourceDisplayName,
		externalKey: r.externalKey,
		lifecycleStatus: (r.lifecycleStatus ??
			null) as SessionLifecycleStatus | null,
		lastRemoteMessageAt: r.lastRemoteMessageAt,
	}));
}

export function listChatSessionsForProject(
	projectId: string,
	limit = 20,
): ChatSessionSummary[] {
	const trimmed = projectId.trim();
	if (!trimmed) return [];
	const db = getDb();
	const rows = db
		.query(
			`SELECT id, name, project_id as projectId, created_at as createdAt, updated_at as updatedAt
       FROM chat_sessions
       WHERE project_id = $project_id
       ORDER BY updated_at DESC
       LIMIT $limit`,
		)
		.all({
			$project_id: trimmed,
			$limit: Math.max(1, Math.min(100, limit)),
		}) as Array<{
		id: string;
		name: string;
		projectId: string | null;
		createdAt: string;
		updatedAt: string;
	}>;
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		projectId: r.projectId,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	}));
}

export function loadChatSession(sessionId: string): LoadedChatSession | null {
	const db = getDb();
	ensureChatSessionContextWindowColumn(db);
	const sess = db
		.query(
			`SELECT id, name, project_id as projectId, settings_json as settingsJson,
              context_window_json as contextWindowJson
       FROM chat_sessions WHERE id = $id`,
		)
		.get({ $id: sessionId }) as
		| {
				id: string;
				name: string;
				projectId: string | null;
				settingsJson: string | null;
				contextWindowJson: string | null;
		  }
		| undefined;
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
	const transcript: TranscriptEntry[] = transcriptRows.map((r) =>
		deserializeTranscriptRow({ kind: r.kind as string, text: r.text }),
	);
	const contextWindow = parseContextWindowJson(sess.contextWindowJson);
	const settings = parseSessionSettingsJson(sess.settingsJson);

	return {
		id: sess.id,
		name: sess.name,
		messages,
		transcript,
		settings: {
			...settings,
			...(sess.projectId ? { projectId: sess.projectId } : {}),
		},
		...(contextWindow ? { contextWindow } : {}),
	};
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
		db.query("DELETE FROM chat_external_sessions").run();
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

/**
 * Replace the full model message history for a session (used after compaction).
 * Deletes existing rows then writes `messages` at indices 0..n-1.
 * Does not touch the UI transcript table.
 */
export function replaceSessionMessages(
	sessionId: string,
	messages: readonly CoreMessage[],
): void {
	const id = sessionId.trim();
	if (!id) return;
	const db = getDb();
	const del = db.query(
		"DELETE FROM chat_session_messages WHERE session_id = $id",
	);
	const insert = db.query(
		`INSERT INTO chat_session_messages (session_id, idx, role, content_json)
     VALUES ($session_id, $idx, $role, $content_json)`,
	);
	const tx = db.transaction(() => {
		del.run({ $id: id });
		for (let i = 0; i < messages.length; i++) {
			const m = messages[i];
			if (!m) continue;
			insert.run({
				$session_id: id,
				$idx: i,
				$role: m.role,
				$content_json: JSON.stringify(m.content),
			});
		}
		touchChatSession(id);
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
			const row = serializeTranscriptEntry(e);
			stmt.run({
				$session_id: sessionId,
				$idx: startIdx + i,
				$kind: row.kind,
				$text: row.text,
			});
		}
		touchChatSession(sessionId);
	});
	tx();
}

export function getPretreatmentCache(promptKey: string): UserIntentSpec | null {
	const key = promptKey.trim();
	if (!key) return null;
	const db = getDb();
	const row = db
		.query(
			`SELECT spec_json as specJson
       FROM chat_pretreatment_cache
       WHERE prompt_key = $k`,
		)
		.get({ $k: key }) as { specJson: string } | undefined;
	if (!row?.specJson) return null;

	try {
		const spec = JSON.parse(row.specJson) as UserIntentSpec;
		// Best-effort observability; ignore failures.
		db.query(
			"UPDATE chat_pretreatment_cache SET last_hit_at = $t WHERE prompt_key = $k",
		).run({ $k: key, $t: nowIso() });
		return spec;
	} catch {
		return null;
	}
}

export function setPretreatmentCache(
	promptKey: string,
	spec: UserIntentSpec,
): void {
	const key = promptKey.trim();
	if (!key) return;
	const db = getDb();
	db.query(
		`INSERT OR REPLACE INTO chat_pretreatment_cache (prompt_key, spec_json, created_at, last_hit_at)
     VALUES ($k, $s, $c, $h)`,
	).run({
		$k: key,
		$s: JSON.stringify(spec),
		$c: nowIso(),
		$h: null,
	});
}

export type RoutingEntityType = "tool" | "skill";

export type StoredRoutingEmbedding = {
	readonly entityType: RoutingEntityType;
	readonly entityId: string;
	readonly vector: number[];
};

export function loadRoutingEmbeddings(params: {
	readonly catalogSignature: string;
	readonly model: string;
}): StoredRoutingEmbedding[] {
	const db = getDb();
	const rows = db
		.query(
			`SELECT entity_type as entityType, entity_id as entityId, embedding_blob as embeddingBlob
       FROM routing_embeddings
       WHERE catalog_signature = $sig AND model = $model`,
		)
		.all({
			$sig: params.catalogSignature,
			$model: params.model,
		}) as Array<{
		entityType: string;
		entityId: string;
		embeddingBlob: Buffer;
	}>;

	const out: StoredRoutingEmbedding[] = [];
	for (const row of rows) {
		if (row.entityType !== "tool" && row.entityType !== "skill") {
			continue;
		}
		out.push({
			entityType: row.entityType,
			entityId: row.entityId,
			vector: bufferToRoutingVector(row.embeddingBlob),
		});
	}
	return out;
}

export function upsertRoutingEmbedding(params: {
	readonly entityType: RoutingEntityType;
	readonly entityId: string;
	readonly catalogSignature: string;
	readonly model: string;
	readonly vector: readonly number[];
}): void {
	const db = getDb();
	db.query(
		`INSERT OR REPLACE INTO routing_embeddings
       (entity_type, entity_id, catalog_signature, model, embedding_blob, created_at)
       VALUES ($type, $id, $sig, $model, $blob, $created)`,
	).run({
		$type: params.entityType,
		$id: params.entityId,
		$sig: params.catalogSignature,
		$model: params.model,
		$blob: routingVectorToBuffer(params.vector),
		$created: nowIso(),
	});
}

export function deleteRoutingEmbeddingsNotMatching(params: {
	readonly catalogSignature: string;
	readonly model: string;
}): void {
	const db = getDb();
	db.query(
		`DELETE FROM routing_embeddings
     WHERE model = $model AND catalog_signature != $sig`,
	).run({ $model: params.model, $sig: params.catalogSignature });
}

function routingVectorToBuffer(vec: readonly number[]): Buffer {
	const f32 = new Float32Array(vec.length);
	for (let i = 0; i < vec.length; i++) {
		f32[i] = vec[i] ?? 0;
	}
	return Buffer.from(f32.buffer);
}

function bufferToRoutingVector(blob: Buffer): number[] {
	const f32 = new Float32Array(
		blob.buffer,
		blob.byteOffset,
		blob.byteLength / Float32Array.BYTES_PER_ELEMENT,
	);
	return Array.from(f32);
}
