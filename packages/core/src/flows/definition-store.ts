import { daemonLog } from "../logging/daemon-log";
import { getDb } from "../session-store";
import {
	getBuiltinFlowDocument,
	isBuiltinFlowId,
	listBuiltinFlowIds,
} from "./builtins";
import type { FlowDocument, StoredFlowRecord } from "./document-types";

function nowIso(): string {
	return new Date().toISOString();
}

function safeJsonParse(raw: string | null | undefined): unknown {
	if (raw == null || raw === "") return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function validateDocument(document: FlowDocument): FlowDocument {
	const id = document.id.trim();
	if (!id) {
		throw new Error("Flow document must have a non-empty id");
	}
	if (!document.name.trim()) {
		throw new Error(`Flow "${id}" must have a non-empty name`);
	}
	if (document.nodes.length === 0) {
		throw new Error(`Flow "${id}" must have at least one node`);
	}
	const ids = new Set<string>();
	for (const node of document.nodes) {
		if (!node.id.trim()) {
			throw new Error(`Flow "${id}" has a node with an empty id`);
		}
		if (ids.has(node.id)) {
			throw new Error(`Flow "${id}" has duplicate node id "${node.id}"`);
		}
		ids.add(node.id);
	}
	return {
		...document,
		id,
		name: document.name.trim(),
		...(document.description !== undefined
			? { description: document.description }
			: {}),
	};
}

function rowToRecord(row: Record<string, unknown>): StoredFlowRecord | null {
	const parsed = safeJsonParse(row.definition_json as string);
	if (!parsed || typeof parsed !== "object") {
		daemonLog("warn", "general", "flow_definition_parse_failed", {
			id: row.id,
		});
		return null;
	}
	const document = parsed as FlowDocument;
	return {
		id: row.id as string,
		name: row.name as string,
		description: (row.description as string | null) ?? null,
		builtin: Boolean(row.builtin),
		document: {
			...document,
			id: row.id as string,
			name: (row.name as string) || document.name,
			...(row.description
				? { description: row.description as string }
				: document.description
					? { description: document.description }
					: {}),
		},
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	};
}

function insertDocument(
	document: FlowDocument,
	builtin: boolean,
): StoredFlowRecord {
	const doc = validateDocument(document);
	const db = getDb();
	const ts = nowIso();
	const personaJson = doc.persona ? JSON.stringify(doc.persona) : null;
	const definitionJson = JSON.stringify(doc);

	db.query(
		`INSERT INTO flows (
      id, name, description, persona_json, definition_json, builtin, created_at, updated_at
    ) VALUES (
      $id, $name, $description, $persona_json, $definition_json, $builtin, $created_at, $updated_at
    )`,
	).run({
		$id: doc.id,
		$name: doc.name,
		$description: doc.description ?? null,
		$persona_json: personaJson,
		$definition_json: definitionJson,
		$builtin: builtin ? 1 : 0,
		$created_at: ts,
		$updated_at: ts,
	});

	return {
		id: doc.id,
		name: doc.name,
		description: doc.description ?? null,
		builtin,
		document: doc,
		createdAt: ts,
		updatedAt: ts,
	};
}

/** Load a flow row by id without seeding. */
export function loadFlowRecord(id: string): StoredFlowRecord | null {
	const key = id.trim();
	if (!key) return null;
	const db = getDb();
	const row = db
		.query(
			`SELECT id, name, description, persona_json, definition_json, builtin, created_at, updated_at
       FROM flows WHERE id = $id`,
		)
		.get({ $id: key }) as Record<string, unknown> | undefined;
	if (!row) return null;
	return rowToRecord(row);
}

/**
 * Insert a built-in seed if the id is a known built-in and no row exists.
 *
 * Dashboard built-ins (`dashboard.*`) are refreshed from code when still marked
 * builtin so prompt/helper fixes ship without requiring a manual delete.
 * Non-dashboard built-ins keep seed-on-miss only (never overwrite).
 */
export function ensureBuiltinFlow(id: string): StoredFlowRecord | null {
	const key = id.trim();
	if (!key || !isBuiltinFlowId(key)) return null;

	const seed = getBuiltinFlowDocument(key);
	if (!seed) return null;

	const existing = loadFlowRecord(key);
	if (existing) {
		// Ship dashboard prompt/helper fixes (e.g. no skills catalog, CoT rules)
		// without rewriting SQLite on every load.
		if (
			existing.builtin &&
			key.startsWith("dashboard.") &&
			JSON.stringify(existing.document) !== JSON.stringify(seed)
		) {
			try {
				return upsertFlowDocument(seed, { builtin: true });
			} catch (error) {
				daemonLog("warn", "general", "flow_builtin_refresh_failed", {
					id: key,
					error: error instanceof Error ? error.message : String(error),
				});
				return existing;
			}
		}
		return existing;
	}

	try {
		return insertDocument(seed, true);
	} catch (error) {
		// Race: another process may have inserted the same id.
		const again = loadFlowRecord(key);
		if (again) return again;
		daemonLog("warn", "general", "flow_builtin_seed_failed", {
			id: key,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

/** Ensure every known built-in id has a row. */
export function ensureAllBuiltinFlows(): void {
	for (const id of listBuiltinFlowIds()) {
		ensureBuiltinFlow(id);
	}
}

/**
 * Get a flow record by id, seeding built-ins on first miss.
 */
export function getFlowRecord(id: string): StoredFlowRecord | null {
	const key = id.trim();
	if (!key) return null;
	const existing = loadFlowRecord(key);
	if (existing) return existing;
	return ensureBuiltinFlow(key);
}

/** List all stored flow records (after ensuring built-ins exist). */
export function listFlowRecords(): readonly StoredFlowRecord[] {
	ensureAllBuiltinFlows();
	const db = getDb();
	const rows = db
		.query(
			`SELECT id, name, description, persona_json, definition_json, builtin, created_at, updated_at
       FROM flows
       ORDER BY name ASC`,
		)
		.all() as Array<Record<string, unknown>>;

	const out: StoredFlowRecord[] = [];
	for (const row of rows) {
		const record = rowToRecord(row);
		if (record) out.push(record);
	}
	return out;
}

/**
 * Insert or replace a flow document.
 * Used for future user create/edit and tests.
 */
export function upsertFlowDocument(
	document: FlowDocument,
	options?: { readonly builtin?: boolean },
): StoredFlowRecord {
	const doc = validateDocument(document);
	const db = getDb();
	const ts = nowIso();
	const existing = loadFlowRecord(doc.id);
	const builtin = options?.builtin ?? existing?.builtin ?? false;
	const personaJson = doc.persona ? JSON.stringify(doc.persona) : null;
	const definitionJson = JSON.stringify(doc);
	const createdAt = existing?.createdAt ?? ts;

	db.query(
		`INSERT INTO flows (
      id, name, description, persona_json, definition_json, builtin, created_at, updated_at
    ) VALUES (
      $id, $name, $description, $persona_json, $definition_json, $builtin, $created_at, $updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      persona_json = excluded.persona_json,
      definition_json = excluded.definition_json,
      builtin = excluded.builtin,
      updated_at = excluded.updated_at`,
	).run({
		$id: doc.id,
		$name: doc.name,
		$description: doc.description ?? null,
		$persona_json: personaJson,
		$definition_json: definitionJson,
		$builtin: builtin ? 1 : 0,
		$created_at: createdAt,
		$updated_at: ts,
	});

	return {
		id: doc.id,
		name: doc.name,
		description: doc.description ?? null,
		builtin,
		document: doc,
		createdAt,
		updatedAt: ts,
	};
}

/** Delete a flow definition by id. Returns true if a row was removed. */
export function deleteFlowDocument(id: string): boolean {
	const key = id.trim();
	if (!key) return false;
	const db = getDb();
	const result = db
		.query("DELETE FROM flows WHERE id = $id")
		.run({ $id: key }) as { changes?: number };
	return (result.changes ?? 0) > 0;
}

/**
 * Persist a user-authored flow. Refuses to create or overwrite built-in rows.
 */
export function saveUserFlowDocument(document: FlowDocument): StoredFlowRecord {
	const existing = loadFlowRecord(document.id.trim());
	if (existing?.builtin) {
		throw new Error(`Cannot overwrite built-in flow "${existing.id}"`);
	}
	return upsertFlowDocument(document, { builtin: false });
}

/**
 * Delete a user-authored flow. Refuses built-in rows.
 * Returns false when no row exists.
 */
export function deleteUserFlowDocument(id: string): boolean {
	const key = id.trim();
	if (!key) return false;
	const existing = loadFlowRecord(key);
	if (!existing) return false;
	if (existing.builtin) {
		throw new Error(`Cannot delete built-in flow "${key}"`);
	}
	return deleteFlowDocument(key);
}
