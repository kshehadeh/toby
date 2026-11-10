import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveTobyDir } from "../config";
import { type SqliteDb, getDb } from "../session-store";
import { parseTodoOperation } from "./operation";
import type { Change, EntityKind, TodoOperation } from "./types";
import { TodoError } from "./types";

type Register = { value: unknown; stamp: string };
export type Entity = {
	kind: EntityKind;
	id: string;
	fields: Record<string, Register>;
};
const initialized = new WeakSet<SqliteDb>();

export function todoDb(): SqliteDb {
	const db = getDb();
	if (!initialized.has(db)) {
		db.exec(`
CREATE TABLE IF NOT EXISTS todo_entities (
 kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(kind,id)
);
CREATE TABLE IF NOT EXISTS todo_operations (
 id TEXT PRIMARY KEY, replica TEXT NOT NULL, clock INTEGER NOT NULL,
 data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS todo_requests (
 key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS todo_local (
 key TEXT PRIMARY KEY, value TEXT NOT NULL
);
`);
		initialized.add(db);
	}
	return db;
}

export function entity(kind: EntityKind, id: string): Entity | null {
	const row = todoDb()
		.query("SELECT data FROM todo_entities WHERE kind=$kind AND id=$id")
		.get({ $kind: kind, $id: id }) as { data: string } | null;
	return row ? (JSON.parse(row.data) as Entity) : null;
}
export function entities(kind: EntityKind): Entity[] {
	return (
		todoDb()
			.query("SELECT data FROM todo_entities WHERE kind=$kind ORDER BY id")
			.all({ $kind: kind }) as { data: string }[]
	).map((row) => JSON.parse(row.data) as Entity);
}
export function values(record: Entity): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(record.fields).map(([key, field]) => [key, field.value]),
	);
}
export function revision(record: Entity): string {
	return hash(
		Object.fromEntries(
			Object.entries(record.fields).sort(([a], [b]) => a.localeCompare(b)),
		),
	);
}
export function hash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function operationStamp(op: TodoOperation): string {
	return `${op.clock.toString().padStart(16, "0")}:${op.replica}:${op.id}`;
}
export function localValue(key: string): string | null {
	const row = todoDb()
		.query("SELECT value FROM todo_local WHERE key=$key")
		.get({ $key: key }) as { value: string } | null;
	return row?.value ?? null;
}
export function setLocalValue(key: string, value: string): void {
	todoDb()
		.query("INSERT OR REPLACE INTO todo_local(key,value) VALUES($key,$value)")
		.run({ $key: key, $value: value });
}

/**
 * Notify that todos have changed by touching a file the app can watch.
 * This allows the macOS app to immediately reconcile notifications when
 * todos are created or modified via chat/CLI/daemon instead of waiting
 * up to 30 seconds for the next poll interval.
 */
function notifyTodosChanged(): void {
	try {
		const notifyPath = path.join(resolveTobyDir(), ".todos-changed");
		const now = new Date();
		fs.utimesSync(notifyPath, now, now);
	} catch {
		// File doesn't exist yet; create it
		try {
			const notifyPath = path.join(resolveTobyDir(), ".todos-changed");
			fs.writeFileSync(notifyPath, String(Date.now()), "utf-8");
		} catch {
			// Ignore errors; this is a best-effort notification
		}
	}
}
export function applyOperation(op: TodoOperation): boolean {
	parseTodoOperation(op);
	const db = todoDb();
	const applied = db.transaction(() => {
		const existing = db
			.query("SELECT data FROM todo_operations WHERE id=$id")
			.get({ $id: op.id }) as { data: string } | null;
		if (existing) {
			if (existing.data !== JSON.stringify(op))
				throw new TodoError(
					"operation_conflict",
					"An operation ID was reused with different content.",
					409,
				);
			return false;
		}
		const stamp = operationStamp(op);
		for (const change of op.changes) {
			const record = entity(change.kind, change.id) ?? {
				kind: change.kind,
				id: change.id,
				fields: {},
			};
			for (const [key, value] of Object.entries(change.fields)) {
				if (!record.fields[key] || record.fields[key].stamp < stamp)
					record.fields[key] = { value, stamp };
			}
			db.query(
				"INSERT OR REPLACE INTO todo_entities(kind,id,data) VALUES($kind,$id,$data)",
			).run({
				$kind: record.kind,
				$id: record.id,
				$data: JSON.stringify(record),
			});
		}
		db.query(
			"INSERT INTO todo_operations(id,replica,clock,data) VALUES($id,$replica,$clock,$data)",
		).run({
			$id: op.id,
			$replica: op.replica,
			$clock: op.clock,
			$data: JSON.stringify(op),
		});
		const previous = Number(localValue("clock") ?? 0);
		if (op.clock > previous) setLocalValue("clock", String(op.clock));
		return true;
	})();

	if (applied) {
		notifyTodosChanged();
	}

	return applied;
}
export function operations(): TodoOperation[] {
	return (
		todoDb()
			.query("SELECT data FROM todo_operations ORDER BY clock,replica,id")
			.all() as { data: string }[]
	).map((row) => JSON.parse(row.data) as TodoOperation);
}
export function mutate<T>(params: {
	action: string;
	input: unknown;
	source?: string;
	now: string;
	replica: string;
	key?: string;
	dryRun?: boolean;
	build: () => { changes: Change[]; result: () => T };
}): T | { dryRun: true; changes: Change[] } {
	const db = todoDb();
	return db.transaction(() => {
		const fingerprint = hash({ action: params.action, input: params.input });
		if (params.key) {
			const cached = db
				.query("SELECT fingerprint,result FROM todo_requests WHERE key=$key")
				.get({ $key: params.key }) as {
				fingerprint: string;
				result: string;
			} | null;
			if (cached) {
				if (cached.fingerprint !== fingerprint)
					throw new TodoError(
						"idempotency_conflict",
						"This idempotency key was already used for different inputs.",
						409,
					);
				return JSON.parse(cached.result) as T;
			}
		}
		const built = params.build();
		if (params.dryRun) return { dryRun: true as const, changes: built.changes };
		const op: TodoOperation = {
			version: 1,
			id: randomUUID(),
			replica: params.replica,
			clock: Number(localValue("clock") ?? 0) + 1,
			at: params.now,
			source: params.source ?? "api",
			changes: built.changes,
		};
		applyOperation(op);
		const result = built.result();
		if (params.key)
			db.query(
				"INSERT INTO todo_requests(key,fingerprint,result) VALUES($key,$fingerprint,$result)",
			).run({
				$key: params.key,
				$fingerprint: fingerprint,
				$result: JSON.stringify(result),
			});
		return result;
	})();
}
