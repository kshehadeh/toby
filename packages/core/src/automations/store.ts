import { randomUUID } from "node:crypto";
import { getFlowRecord } from "../flows/definition-store";
import { getDb } from "../session-store";
import { automationInputs, localParts, matchReason } from "./matcher";
import {
	type Automation,
	type AutomationEvent,
	type AutomationRun,
	automationDraftSchema,
	automationEventSchema,
} from "./types";

export function listAutomations(): Automation[] {
	return getDb()
		.query("SELECT definition_json FROM automations ORDER BY created_at DESC")
		.all()
		.map((r) => JSON.parse((r as { definition_json: string }).definition_json));
}
export function getAutomation(id: string): Automation | null {
	return listAutomations().find((a) => a.id === id) ?? null;
}
export function validateAutomationFlow(flowId: string) {
	const flow = getFlowRecord(flowId);
	if (!flow || flow.builtin) throw new Error("Select an existing custom flow");
	if (
		flow.document.nodes.some(
			(n) => n.outputs && Object.hasOwn(n.outputs, "automation"),
		)
	)
		throw new Error("Flow overwrites reserved automation context");
	return flow;
}
export function validateAutomationDraft(value: unknown) {
	const draft = automationDraftSchema.parse(value);
	if (draft.enabled || getFlowRecord(draft.action.flowId))
		validateAutomationFlow(draft.action.flowId);
	if (
		draft.trigger.type !== "macos.userReturned" &&
		Object.values(draft.action.eventInputMappings).includes(
			"payload.idleSeconds",
		)
	)
		throw new Error("This trigger has no idleSeconds field");
	if (
		draft.trigger.type !== "macos.fileChanges" &&
		Object.values(draft.action.eventInputMappings).some(
			(p) => p === "payload.changes" || p === "payload.folder",
		)
	)
		throw new Error("This trigger has no file fields");
	return draft;
}
export function saveAutomation(
	value: unknown,
	id?: string,
	revision?: number,
): Automation {
	const draft = validateAutomationDraft(value);
	const db = getDb();
	return db.transaction(() => {
		const existing = id ? getAutomation(id) : null;
		if (id && !existing) throw new Error("Automation not found");
		if (existing && revision !== existing.revision)
			throw new Error("Automation changed; reload before saving");
		const now = new Date().toISOString();
		const a: Automation = {
			...draft,
			id: existing?.id ?? randomUUID(),
			revision: (existing?.revision ?? 0) + 1,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		db.query(
			"INSERT INTO automations VALUES ($id,$json,$revision,$created,$updated) ON CONFLICT(id) DO UPDATE SET definition_json=excluded.definition_json, revision=excluded.revision, updated_at=excluded.updated_at",
		).run({
			$id: a.id,
			$json: JSON.stringify(a),
			$revision: a.revision,
			$created: a.createdAt,
			$updated: now,
		});
		return a;
	})();
}
export function deleteAutomation(id: string) {
	getDb().query("DELETE FROM automations WHERE id=$id").run({ $id: id });
}
function parseRun(row: unknown): AutomationRun {
	const r = row as Record<string, unknown>;
	return {
		id: r.id as string,
		automationId: r.automation_id as string,
		eventId: r.event_id as string,
		definition: JSON.parse(r.definition_json as string),
		event: JSON.parse(r.event_json as string),
		status: r.status as string,
		reason: r.reason as string | null,
		flowRunId: r.flow_run_id as string | null,
		output: r.output as string | null,
		createdAt: r.created_at as string,
		completedAt: r.completed_at as string | null,
	};
}
export function listAutomationRuns(id?: string, limit = 100): AutomationRun[] {
	return getDb()
		.query(
			"SELECT * FROM automation_runs WHERE ($id IS NULL OR automation_id=$id) ORDER BY created_at DESC LIMIT $limit",
		)
		.all({ $id: id ?? null, $limit: Math.min(500, Math.max(1, limit)) })
		.map(parseRun);
}
export function getAutomationRun(id: string): AutomationRun | null {
	const row = getDb()
		.query("SELECT * FROM automation_runs WHERE id=$id")
		.get({ $id: id });
	return row ? parseRun(row) : null;
}
function state(id: string) {
	const row = getDb()
		.query(
			"SELECT last_claim_at, claimed_day FROM automation_state WHERE automation_id=$id",
		)
		.get({ $id: id }) as {
		last_claim_at: string | null;
		claimed_day: string | null;
	} | null;
	return { lastClaimAt: row?.last_claim_at, claimedDay: row?.claimed_day };
}
export function previewAutomation(
	a: Automation,
	e: AutomationEvent,
	now = new Date(),
) {
	let reason = matchReason(a, e, now, state(a.id));
	let inputs: Record<string, unknown> | null = null;
	try {
		validateAutomationFlow(a.action.flowId);
		inputs = automationInputs(a, e, "preview");
	} catch (error) {
		reason = String(error);
	}
	return { matches: reason === null, reason, inputs };
}
export function ingestAutomationBatch(
	values: unknown[],
	cursor: { sessionId: string; sequence: number },
	now = new Date(),
): void {
	const events = values.map((v) => automationEventSchema.parse(v));
	if (
		events.some(
			(e) =>
				e.observationSessionId !== cursor.sessionId ||
				e.sequence > cursor.sequence,
		)
	)
		throw new Error("Invalid batch cursor");
	const db = getDb();
	db.transaction(() => {
		for (const e of events) {
			if (
				db
					.query("SELECT id FROM automation_events WHERE id=$id")
					.get({ $id: e.id })
			)
				continue;
			db.query("INSERT INTO automation_events VALUES ($id,$event,$now)").run({
				$id: e.id,
				$event: JSON.stringify(e),
				$now: now.toISOString(),
			});
			for (const a of listAutomations().filter(
				(a) =>
					a.enabled &&
					a.trigger.type === e.type &&
					(e.type !== "macos.fileChanges" ||
						e.payload.watchId === `${a.id}:${a.revision}`),
			)) {
				let reason = matchReason(a, e, now, state(a.id));
				try {
					validateAutomationFlow(a.action.flowId);
					automationInputs(a, e, "validation");
				} catch (error) {
					reason = error instanceof Error ? error.message : String(error);
				}
				if (
					!reason &&
					e.type !== "macos.fileChanges" &&
					db
						.query(
							"SELECT id FROM automation_runs WHERE automation_id=$id AND status IN ('pending','running') LIMIT 1",
						)
						.get({ $id: a.id })
				)
					reason = "busy";
				if (
					!reason &&
					(
						db
							.query(
								"SELECT COUNT(*) AS count FROM automation_runs WHERE status='pending'",
							)
							.get() as { count: number }
					).count >= 100
				)
					reason = "capacity";
				const runId = randomUUID();
				db.query(
					"INSERT INTO automation_runs (id,automation_id,event_id,definition_json,event_json,status,reason,created_at,completed_at) VALUES ($id,$automation,$eventId,$definition,$event,$status,$reason,$now,$completed)",
				).run({
					$id: runId,
					$automation: a.id,
					$eventId: e.id,
					$definition: JSON.stringify(a),
					$event: JSON.stringify(e),
					$status: reason ? "skipped" : "pending",
					$reason: reason,
					$now: now.toISOString(),
					$completed: reason ? now.toISOString() : null,
				});
				if (!reason)
					db.query(
						"INSERT INTO automation_state VALUES ($id,$now,$day) ON CONFLICT(automation_id) DO UPDATE SET last_claim_at=excluded.last_claim_at, claimed_day=excluded.claimed_day",
					).run({
						$id: a.id,
						$now: now.toISOString(),
						$day: localParts(now, a.conditions.timezone).day,
					});
			}
		}
		db.query(
			"INSERT INTO automation_cursor VALUES ('macos',$session,$sequence) ON CONFLICT(source) DO UPDATE SET session_id=excluded.session_id, sequence=excluded.sequence",
		).run({ $session: cursor.sessionId, $sequence: cursor.sequence });
	})();
}
export function claimPendingAutomation(now = new Date()): AutomationRun | null {
	const db = getDb();
	return db.transaction(() => {
		const row = db
			.query(
				"SELECT * FROM automation_runs AS pending WHERE status='pending' AND NOT EXISTS (SELECT 1 FROM automation_runs AS active WHERE active.automation_id=pending.automation_id AND active.status='running') ORDER BY created_at LIMIT 1",
			)
			.get();
		if (!row) return null;
		const run = parseRun(row);
		const current = getAutomation(run.automationId);
		let reason = !current ? "deleted" : !current.enabled ? "disabled" : null;
		if (now.getTime() - Date.parse(run.event.occurredAt) > 120000)
			reason = "stale_event";
		if (reason) {
			finishAutomationRun(run.id, "skipped", reason);
			return null;
		}
		db.query(
			"UPDATE automation_runs SET status='running' WHERE id=$id AND status='pending'",
		).run({ $id: run.id });
		return { ...run, status: "running" };
	})();
}
export function finishAutomationRun(
	id: string,
	status: string,
	reason: string | null,
	flowRunId: string | null = null,
	output: string | null = null,
) {
	getDb()
		.query(
			"UPDATE automation_runs SET status=$status,reason=$reason,flow_run_id=$flow,output=$output,completed_at=$now WHERE id=$id",
		)
		.run({
			$id: id,
			$status: status,
			$reason: reason,
			$flow: flowRunId,
			$output: output,
			$now: new Date().toISOString(),
		});
}
export function recoverAutomationRuns() {
	getDb()
		.query(
			"UPDATE automation_runs SET status='interrupted',reason='Daemon stopped; external effects may already have occurred',completed_at=$now WHERE status IN ('pending','running')",
		)
		.run({ $now: new Date().toISOString() });
}
export function pruneAutomationHistory(now = new Date()) {
	const cutoff = new Date(now.getTime() - 30 * 86400000).toISOString();
	getDb()
		.query("DELETE FROM automation_events WHERE received_at<$cutoff")
		.run({ $cutoff: cutoff });
	getDb()
		.query(
			"DELETE FROM automation_runs WHERE status='skipped' AND created_at<$cutoff",
		)
		.run({ $cutoff: cutoff });
}
