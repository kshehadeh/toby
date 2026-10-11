import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import { getDb } from "../../session-store";
import { getFlowRecord, listFlowRecords } from "../definition-store";
import type { FlowDocument } from "../document-types";
import { getByPath } from "../resolve-inputs";
import { localParts, matchReason } from "./native-matcher";
import { type NativeTriggerEvent, nativeEventSchema } from "./native-types";
import { type FlowTrigger, isUserInvokedTrigger, manualTrigger } from "./types";

export interface TriggerBinding {
	id: string;
	revision: number;
	flowId: string;
	trigger: FlowTrigger;
	document: FlowDocument;
	createdAt: string;
}
export interface TriggerEvent {
	id: string;
	type: string;
	occurredAt: string;
	payload: Record<string, unknown>;
}
export interface TriggerDecision {
	id: string;
	binding: TriggerBinding;
	event: TriggerEvent;
	status: string;
	reason: string | null;
	flowRunId: string | null;
	output: string | null;
	createdAt: string;
}
function db() {
	const database = getDb();
	database.exec(`
    CREATE TABLE IF NOT EXISTS flow_trigger_decisions (
      id TEXT PRIMARY KEY, binding_id TEXT NOT NULL, flow_id TEXT NOT NULL,
      occurrence_id TEXT NOT NULL, binding_json TEXT NOT NULL, event_json TEXT NOT NULL,
      status TEXT NOT NULL, reason TEXT, flow_run_id TEXT, output TEXT, created_at TEXT NOT NULL,
      UNIQUE(binding_id, occurrence_id));
    CREATE INDEX IF NOT EXISTS flow_trigger_queue ON flow_trigger_decisions(status, created_at);
    CREATE TABLE IF NOT EXISTS flow_trigger_state (
      binding_id TEXT PRIMARY KEY, last_claim_at TEXT, claimed_day TEXT);
    CREATE TABLE IF NOT EXISTS flow_trigger_cursor (
      source TEXT PRIMARY KEY, session_id TEXT NOT NULL, sequence INTEGER NOT NULL);
  `);
	return database;
}
export function listTriggerBindings(): TriggerBinding[] {
	return listFlowRecords()
		.filter((f) => !f.builtin)
		.flatMap((flow) =>
			(flow.document.triggers ?? [manualTrigger()]).map((trigger) => ({
				id: `${flow.id}/${trigger.id}`,
				revision: flow.document.revision ?? 0,
				flowId: flow.id,
				trigger,
				document: flow.document,
				createdAt: flow.createdAt,
			})),
		);
}
export function triggerInputs(
	binding: TriggerBinding,
	event: TriggerEvent,
	runId: string,
) {
	const inputs: Record<string, unknown> = { ...binding.trigger.inputs };
	for (const [key, path] of Object.entries(
		binding.trigger.eventInputMappings,
	)) {
		const value = getByPath(event, path);
		if (value === undefined) throw new Error(`Event has no field ${path}`);
		inputs[key] = value;
	}
	inputs.trigger = { id: binding.trigger.id, runId, event };
	return inputs;
}
function decode(row: unknown): TriggerDecision {
	const r = row as {
		id: string;
		binding_json: string;
		event_json: string;
		status: string;
		reason: string | null;
		flow_run_id: string | null;
		output: string | null;
		created_at: string;
	};
	return {
		id: r.id,
		binding: JSON.parse(r.binding_json),
		event: JSON.parse(r.event_json),
		status: r.status,
		reason: r.reason,
		flowRunId: r.flow_run_id,
		output: r.output,
		createdAt: r.created_at,
	};
}
export function listTriggerDecisions(flowId?: string): TriggerDecision[] {
	return db()
		.query(
			"SELECT * FROM flow_trigger_decisions WHERE ($flow IS NULL OR flow_id=$flow) ORDER BY created_at DESC, rowid DESC LIMIT 100",
		)
		.all({ $flow: flowId ?? null })
		.map(decode);
}
export function finishTriggerDecision(
	id: string,
	status: string,
	reason: string | null,
	flowRunId: string | null = null,
	output: string | null = null,
) {
	db()
		.query(
			"UPDATE flow_trigger_decisions SET status=$status,reason=$reason,flow_run_id=$run,output=$output WHERE id=$id",
		)
		.run({
			$id: id,
			$status: status,
			$reason: reason,
			$run: flowRunId,
			$output: output,
		});
}
function decisionReason(
	binding: TriggerBinding,
	event: TriggerEvent,
	now: Date,
): string | null {
	const t = binding.trigger;
	if (!t.enabled) return "disabled";
	if (t.source.type !== event.type) return "trigger_mismatch";
	const state = db()
		.query(
			"SELECT last_claim_at,claimed_day FROM flow_trigger_state WHERE binding_id=$id",
		)
		.get({ $id: binding.id }) as {
		last_claim_at: string;
		claimed_day: string;
	} | null;
	if (t.source.type.startsWith("macos.")) {
		const native = nativeEventSchema.parse(event);
		// Reuse native matching semantics; the Flow owns the trigger and policy.
		const reason = matchReason(
			{
				id: binding.id,
				revision: binding.revision,
				name: t.name,
				enabled: t.enabled,
				trigger: t.source as Extract<
					FlowTrigger["source"],
					{ type: NativeTriggerEvent["type"] }
				>,
				conditions: t.conditions,
				policy: t.policy,
				action: {
					type: "flow",
					flowId: binding.flowId,
					inputs: t.inputs,
					eventInputMappings: t.eventInputMappings,
				},
				notifyOnCompletion: t.notifyOnCompletion,
				createdAt: binding.createdAt,
				updatedAt: binding.createdAt,
			},
			native,
			now,
			{ lastClaimAt: state?.last_claim_at, claimedDay: state?.claimed_day },
		);
		if (reason) return reason;
	} else if (!isUserInvokedTrigger(t.source.type)) {
		const local = localParts(new Date(event.occurredAt), t.conditions.timezone);
		if (t.conditions.weekdays && !t.conditions.weekdays.includes(local.weekday))
			return "weekday";
		const window = t.conditions.timeWindow;
		if (
			window &&
			!(window.start < window.end
				? local.time >= window.start && local.time < window.end
				: local.time >= window.start || local.time < window.end)
		)
			return "time_window";
		if (
			t.policy.oncePerDay &&
			state?.claimed_day === localParts(now, t.conditions.timezone).day
		)
			return "daily_limit";
		if (
			state?.last_claim_at &&
			now.getTime() - Date.parse(state.last_claim_at) <
				t.policy.cooldownSeconds * 1000
		)
			return "cooldown";
	}
	try {
		triggerInputs(binding, event, "preview");
	} catch (error) {
		return String(error);
	}
	if (
		t.source.type !== "macos.fileChanges" &&
		db()
			.query(
				"SELECT id FROM flow_trigger_decisions WHERE binding_id=$id AND status IN ('pending','running')",
			)
			.get({ $id: binding.id })
	)
		return "busy";
	const pending = db()
		.query(
			"SELECT count(*) AS n FROM flow_trigger_decisions WHERE status='pending'",
		)
		.get() as { n: number };
	return pending.n >= 100 ? "capacity" : null;
}
export function previewTrigger(
	binding: TriggerBinding,
	event: TriggerEvent,
	now = new Date(),
) {
	const reason = decisionReason(binding, event, now);
	return { matches: reason === null, reason };
}
export function enqueueTrigger(
	binding: TriggerBinding,
	event: TriggerEvent,
	now = new Date(),
	occurrenceId = event.id,
): string | null {
	const database = db();
	return database.transaction(() => {
		if (
			database
				.query(
					"SELECT id FROM flow_trigger_decisions WHERE binding_id=$id AND occurrence_id=$event",
				)
				.get({ $id: binding.id, $event: occurrenceId })
		)
			return null;
		const reason = decisionReason(binding, event, now);
		const id = randomUUID();
		database
			.query(
				"INSERT INTO flow_trigger_decisions (id,binding_id,flow_id,occurrence_id,binding_json,event_json,status,reason,created_at) VALUES ($id,$binding,$flow,$event,$definition,$payload,$status,$reason,$now)",
			)
			.run({
				$id: id,
				$binding: binding.id,
				$flow: binding.flowId,
				$event: occurrenceId,
				$definition: JSON.stringify(binding),
				$payload: JSON.stringify(event),
				$status: reason ? "skipped" : "pending",
				$reason: reason,
				$now: now.toISOString(),
			});
		if (!reason && !isUserInvokedTrigger(binding.trigger.source.type))
			database
				.query(
					"INSERT INTO flow_trigger_state VALUES ($id,$now,$day) ON CONFLICT(binding_id) DO UPDATE SET last_claim_at=excluded.last_claim_at,claimed_day=excluded.claimed_day",
				)
				.run({
					$id: binding.id,
					$now: now.toISOString(),
					$day: localParts(now, binding.trigger.conditions.timezone).day,
				});
		return id;
	})();
}
export function ingestNativeEvents(
	values: unknown[],
	cursor: { sessionId: string; sequence: number },
	now = new Date(),
) {
	const events = values.map((value) => nativeEventSchema.parse(value));
	const bindings = listTriggerBindings().filter((b) => b.trigger.enabled);
	db().transaction(() => {
		for (const event of events) {
			if (
				event.observationSessionId !== cursor.sessionId ||
				event.sequence > cursor.sequence
			)
				throw new Error("Invalid native cursor");
			for (const binding of bindings) {
				if (binding.trigger.source.type !== event.type) continue;
				if (
					event.type === "macos.fileChanges" &&
					event.payload.watchId !== `${binding.id}:${binding.revision}`
				)
					continue;
				if (
					event.type === "macos.fileChanges" &&
					binding.trigger.source.type === "macos.fileChanges" &&
					binding.trigger.source.runPerFile
				) {
					for (const [index, change] of event.payload.changes.entries()) {
						enqueueTrigger(
							binding,
							{ ...event, payload: { ...event.payload, changes: [change] } },
							now,
							`${event.id}:file:${index}`,
						);
					}
				} else enqueueTrigger(binding, event, now);
			}
		}
		db()
			.query(
				"INSERT INTO flow_trigger_cursor VALUES ('macos',$session,$sequence) ON CONFLICT(source) DO UPDATE SET session_id=excluded.session_id,sequence=excluded.sequence",
			)
			.run({ $session: cursor.sessionId, $sequence: cursor.sequence });
	})();
}
export function enqueueScheduledFlows(now = new Date()) {
	for (const binding of listTriggerBindings()) {
		const source = binding.trigger.source;
		if (!binding.trigger.enabled || source.type !== "schedule") continue;
		const cron = new Cron(source.cron, {
			timezone: binding.trigger.conditions.timezone,
		});
		const occurrence = cron.previousRuns(1, now)[0];
		if (!occurrence || occurrence.getTime() < Date.parse(binding.createdAt))
			continue;
		if (
			source.missedRuns === "skip" &&
			now.getTime() - occurrence.getTime() > 60000
		)
			continue;
		enqueueTrigger(
			binding,
			{
				id: `schedule:${binding.id}:${occurrence.toISOString()}`,
				type: "schedule",
				occurredAt: occurrence.toISOString(),
				payload: {},
			},
			now,
		);
	}
}
export function claimTriggerDecision(
	now = new Date(),
	decisionId?: string,
): TriggerDecision | null {
	const database = db();
	return database.transaction(() => {
		const activeCount = database
			.query(
				"SELECT count(*) AS n FROM flow_trigger_decisions WHERE status='running'",
			)
			.get() as { n: number };
		if (activeCount.n >= 2) return null;
		const rows = database
			.query(
				"SELECT * FROM flow_trigger_decisions AS pending WHERE ($id IS NULL OR id=$id) AND status='pending' AND NOT EXISTS (SELECT 1 FROM flow_trigger_decisions AS active WHERE active.flow_id=pending.flow_id AND active.status='running') ORDER BY created_at, rowid",
			)
			.all({ $id: decisionId ?? null });
		for (const row of rows) {
			const run = decode(row);
			const current = (
				getFlowRecord(run.binding.flowId)?.document.triggers ?? []
			).find((t) => t.id === run.binding.trigger.id);
			let reason = !current ? "deleted" : !current.enabled ? "disabled" : null;
			if (
				run.event.type.startsWith("macos.") &&
				now.getTime() - Date.parse(run.event.occurredAt) > 120000
			)
				reason = "stale_event";
			if (reason) {
				finishTriggerDecision(run.id, "skipped", reason);
				continue;
			}
			database
				.query(
					"UPDATE flow_trigger_decisions SET status='running' WHERE id=$id",
				)
				.run({ $id: run.id });
			return { ...run, status: "running" };
		}
		return null;
	})();
}
export function recoverTriggerDecisions() {
	db()
		.query(
			"UPDATE flow_trigger_decisions SET status='interrupted',reason='Daemon stopped; external effects may already have occurred' WHERE status IN ('pending','running')",
		)
		.run();
}
