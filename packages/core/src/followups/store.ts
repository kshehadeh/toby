import { randomUUID } from "node:crypto";
import { getDb } from "../memory/memory-store";
import type { FollowupKind, FollowupLoop, FollowupStatus } from "./types";

type LoopRow = {
	loop_id: string;
	kind: string;
	status: string;
	fingerprint: string;
	title: string;
	counterpart: string | null;
	due_at: string | null;
	confidence: number;
	todo_id: string | null;
	resolution_rejected: number;
	reopened_at: string | null;
	last_evaluated_hash: string | null;
	last_activity_at: string;
	created_at: string;
	updated_at: string;
};

function rowToLoop(row: LoopRow): FollowupLoop {
	return {
		loopId: row.loop_id,
		kind: row.kind as FollowupKind,
		status: row.status as FollowupStatus,
		fingerprint: row.fingerprint,
		title: row.title,
		...(row.counterpart ? { counterpart: row.counterpart } : {}),
		...(row.due_at ? { dueAt: row.due_at } : {}),
		confidence: row.confidence,
		...(row.todo_id ? { todoId: row.todo_id } : {}),
		resolutionRejected: row.resolution_rejected === 1,
		...(row.reopened_at ? { reopenedAt: row.reopened_at } : {}),
		...(row.last_evaluated_hash
			? { lastEvaluatedHash: row.last_evaluated_hash }
			: {}),
		lastActivityAt: row.last_activity_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

const SELECT = `SELECT loop_id, kind, status, fingerprint, title, counterpart, due_at,
 confidence, todo_id, resolution_rejected, reopened_at, last_evaluated_hash, last_activity_at, created_at, updated_at
 FROM followup_loops`;

export function getFollowupLoop(id: string): FollowupLoop | null {
	const row = getDb().query(`${SELECT} WHERE loop_id = $id`).get({ $id: id }) as
		| LoopRow
		| undefined;
	return row ? rowToLoop(row) : null;
}

export function findFollowupByFingerprint(
	fingerprint: string,
): FollowupLoop | null {
	const row = getDb()
		.query(`${SELECT} WHERE fingerprint = $fingerprint`)
		.get({ $fingerprint: fingerprint }) as LoopRow | undefined;
	return row ? rowToLoop(row) : null;
}

export function findFollowupByTodoId(todoId: string): FollowupLoop | null {
	const row = getDb()
		.query(`${SELECT} WHERE todo_id = $todo`)
		.get({ $todo: todoId }) as LoopRow | undefined;
	return row ? rowToLoop(row) : null;
}

export function listFollowupLoops(
	params: {
		readonly status?: FollowupStatus;
		readonly limit?: number;
	} = {},
): FollowupLoop[] {
	const rows = getDb()
		.query(
			`${SELECT} ${params.status ? "WHERE status = $status" : ""} ORDER BY updated_at DESC LIMIT $limit`,
		)
		.all({
			$status: params.status,
			$limit: Math.max(1, Math.min(1000, params.limit ?? 200)),
		}) as LoopRow[];
	return rows.map(rowToLoop);
}

export function createFollowupLoop(input: {
	readonly loopId: string;
	readonly kind: FollowupKind;
	readonly fingerprint: string;
	readonly title: string;
	readonly counterpart?: string;
	readonly dueAt?: string;
	readonly confidence: number;
	readonly todoId?: string;
	readonly lastActivityAt: string;
}): FollowupLoop {
	const at = new Date().toISOString();
	getDb()
		.query(
			`INSERT INTO followup_loops(loop_id, kind, status, fingerprint, title, counterpart, due_at,
     confidence, todo_id, resolution_rejected, last_activity_at, created_at, updated_at)
     VALUES($id, $kind, 'open', $fingerprint, $title, $counterpart, $due, $confidence, $todo, 0, $activity, $at, $at)
     ON CONFLICT(fingerprint) DO UPDATE SET title = excluded.title, counterpart = excluded.counterpart,
       due_at = excluded.due_at, confidence = excluded.confidence, last_activity_at = excluded.last_activity_at,
       updated_at = excluded.updated_at`,
		)
		.run({
			$id: input.loopId,
			$kind: input.kind,
			$fingerprint: input.fingerprint,
			$title: input.title,
			$counterpart: input.counterpart ?? null,
			$due: input.dueAt ?? null,
			$confidence: input.confidence,
			$todo: input.todoId ?? null,
			$activity: input.lastActivityAt,
			$at: at,
		});
	return findFollowupByFingerprint(input.fingerprint) as FollowupLoop;
}

export function updateFollowupLoop(
	id: string,
	patch: Partial<
		Pick<
			FollowupLoop,
			| "status"
			| "todoId"
			| "resolutionRejected"
			| "reopenedAt"
			| "lastEvaluatedHash"
			| "lastActivityAt"
			| "confidence"
			| "title"
			| "counterpart"
			| "dueAt"
		>
	>,
	updatedAt = new Date().toISOString(),
): FollowupLoop | null {
	const current = getFollowupLoop(id);
	if (!current) return null;
	getDb()
		.query(
			`UPDATE followup_loops SET status = $status, todo_id = $todo, resolution_rejected = $rejected, reopened_at = $reopenedAt,
     last_evaluated_hash = $hash, last_activity_at = $activity, confidence = $confidence,
     title = $title, counterpart = $counterpart, due_at = $due, updated_at = $updated WHERE loop_id = $id`,
		)
		.run({
			$id: id,
			$status: patch.status ?? current.status,
			$todo: patch.todoId ?? current.todoId ?? null,
			$rejected:
				(patch.resolutionRejected ?? current.resolutionRejected) ? 1 : 0,
			$reopenedAt: patch.reopenedAt ?? current.reopenedAt ?? null,
			$hash: patch.lastEvaluatedHash ?? current.lastEvaluatedHash ?? null,
			$activity: patch.lastActivityAt ?? current.lastActivityAt,
			$confidence: patch.confidence ?? current.confidence,
			$title: patch.title ?? current.title,
			$counterpart: patch.counterpart ?? current.counterpart ?? null,
			$due: patch.dueAt ?? current.dueAt ?? null,
			$updated: updatedAt,
		});
	return getFollowupLoop(id);
}

export function setFollowupTodoId(id: string, todoId: string): void {
	getDb()
		.query(
			"UPDATE followup_loops SET todo_id = $todo, updated_at = $at WHERE loop_id = $id",
		)
		.run({
			$id: id,
			$todo: todoId,
			$at: new Date().toISOString(),
		});
}

export function getEvaluatedUnitHash(unitId: string): string | null {
	const row = getDb()
		.query("SELECT content_hash FROM followup_unit_hashes WHERE unit_id = $id")
		.get({ $id: unitId }) as { content_hash: string } | undefined;
	return row?.content_hash ?? null;
}

export function markUnitEvaluated(
	unitId: string,
	hash: string,
	at = new Date().toISOString(),
): void {
	getDb()
		.query(
			`INSERT INTO followup_unit_hashes(unit_id, content_hash, evaluated_at) VALUES($id, $hash, $at)
     ON CONFLICT(unit_id) DO UPDATE SET content_hash = $hash, evaluated_at = $at`,
		)
		.run({ $id: unitId, $hash: hash, $at: at });
}

export function listFollowupInstructions(): Array<{
	id: string;
	text: string;
	updatedAt: string;
}> {
	return (
		getDb()
			.query(
				"SELECT id, text, updated_at FROM followup_instructions ORDER BY created_at",
			)
			.all() as Array<{ id: string; text: string; updated_at: string }>
	).map((row) => ({
		id: row.id,
		text: row.text,
		updatedAt: row.updated_at,
	}));
}

export function saveFollowupInstruction(input: { id?: string; text: string }): {
	id: string;
	text: string;
} {
	const id = input.id ?? randomUUID();
	const at = new Date().toISOString();
	getDb()
		.query(
			`INSERT INTO followup_instructions(id, text, created_at, updated_at) VALUES($id, $text, $at, $at)
     ON CONFLICT(id) DO UPDATE SET text = $text, updated_at = $at`,
		)
		.run({ $id: id, $text: input.text.trim().slice(0, 2000), $at: at });
	return { id, text: input.text.trim().slice(0, 2000) };
}

export function deleteFollowupInstruction(id: string): void {
	getDb()
		.query("DELETE FROM followup_instructions WHERE id = $id")
		.run({ $id: id });
}

export function claimEvaluationBudget(
	count: number,
	max: number,
	now = new Date(),
): number {
	const key = `followup_evaluations:${now.toISOString().slice(0, 10)}`;
	const db = getDb();
	return db.transaction(() => {
		const row = db
			.query("SELECT value FROM graph_meta WHERE key = $key")
			.get({ $key: key }) as { value: string } | undefined;
		const used = Number(row?.value ?? 0);
		const allowed = Math.max(0, Math.min(count, max - used));
		if (allowed > 0)
			db.query(
				"INSERT INTO graph_meta(key, value) VALUES($key, $value) ON CONFLICT(key) DO UPDATE SET value = $value",
			).run({ $key: key, $value: String(used + allowed) });
		return allowed;
	})();
}

/** Return reserved units when the evaluator call itself fails before producing a judgment. */
export function refundEvaluationBudget(count: number, now = new Date()): void {
	if (count <= 0) return;
	const key = `followup_evaluations:${now.toISOString().slice(0, 10)}`;
	const db = getDb();
	db.transaction(() => {
		const row = db
			.query("SELECT value FROM graph_meta WHERE key = $key")
			.get({ $key: key }) as { value: string } | undefined;
		const used = Number(row?.value ?? 0);
		if (used <= count)
			db.query("DELETE FROM graph_meta WHERE key = $key").run({ $key: key });
		else
			db.query("UPDATE graph_meta SET value = $value WHERE key = $key").run({
				$key: key,
				$value: String(used - count),
			});
	})();
}

export function getFollowupMeta(key: string): string | null {
	const row = getDb()
		.query("SELECT value FROM graph_meta WHERE key = $key")
		.get({ $key: `followups:${key}` }) as { value: string } | undefined;
	return row?.value ?? null;
}

export function setFollowupMeta(key: string, value: string): void {
	getDb()
		.query(
			`INSERT INTO graph_meta(key, value) VALUES($key, $value)
     ON CONFLICT(key) DO UPDATE SET value = $value`,
		)
		.run({ $key: `followups:${key}`, $value: value });
}

export function recordFollowupFeedback(params: {
	readonly fingerprint: string;
	readonly outcome: "dismissed" | "not_useful" | "reopened";
	readonly reason?: string;
}): void {
	getDb()
		.query(
			"INSERT INTO followup_feedback(id, fingerprint, outcome, reason, created_at) VALUES($id, $fingerprint, $outcome, $reason, $at)",
		)
		.run({
			$id: randomUUID(),
			$fingerprint: params.fingerprint,
			$outcome: params.outcome,
			$reason: params.reason?.slice(0, 500) ?? null,
			$at: new Date().toISOString(),
		});
}
