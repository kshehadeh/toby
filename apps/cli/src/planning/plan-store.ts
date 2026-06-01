import { randomUUID } from "node:crypto";
import { getDb } from "../ui/chat/session-store";
import type { Plan, PlanPhase, PlanPhaseStatus, PlanStatus } from "./types";

function nowIso(): string {
	return new Date().toISOString();
}

export function createPlan(params: {
	sessionId: string;
	goal: string;
	phases: readonly { label: string; description: string }[];
}): Plan {
	const db = getDb();
	const id = randomUUID();
	const ts = nowIso();
	const tx = db.transaction(() => {
		db.query(
			`INSERT INTO chat_plans (id, session_id, goal, status, created_at, updated_at)
       VALUES ($id, $sid, $goal, $status, $ca, $ua)`,
		).run({
			$id: id,
			$sid: params.sessionId,
			$goal: params.goal,
			$status: "pending",
			$ca: ts,
			$ua: ts,
		});
		const stmt = db.query(
			`INSERT INTO chat_plan_phases (id, plan_id, label, description, status, phase_order, added_at)
       VALUES ($id, $pid, $label, $desc, $status, $ord, $aa)`,
		);
		const phases: PlanPhase[] = params.phases.map((p, i) => {
			const phaseId = randomUUID();
			stmt.run({
				$id: phaseId,
				$pid: id,
				$label: p.label,
				$desc: p.description,
				$status: "pending",
				$ord: i,
				$aa: ts,
			});
			return {
				id: phaseId,
				label: p.label,
				description: p.description,
				status: "pending" as const,
				order: i,
				addedAt: ts,
			};
		});
		return phases;
	});
	const phases = tx();
	return {
		id,
		sessionId: params.sessionId,
		goal: params.goal,
		phases,
		status: "pending",
		createdAt: ts,
		updatedAt: ts,
	};
}

export function loadPlanBySession(sessionId: string): Plan | null {
	const db = getDb();
	const row = db
		.query(
			`SELECT id, session_id, goal, status, created_at, updated_at
       FROM chat_plans
       WHERE session_id = $sid
       ORDER BY updated_at DESC
       LIMIT 1`,
		)
		.get({ $sid: sessionId }) as
		| {
				id: string;
				session_id: string;
				goal: string;
				status: string;
				created_at: string;
				updated_at: string;
		  }
		| undefined;
	if (!row) return null;
	const phases = loadPhases(row.id);
	return {
		id: row.id,
		sessionId: row.session_id,
		goal: row.goal,
		phases,
		status: row.status as PlanStatus,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function loadPlan(planId: string): Plan | null {
	const db = getDb();
	const row = db
		.query(
			`SELECT id, session_id, goal, status, created_at, updated_at
       FROM chat_plans
       WHERE id = $id`,
		)
		.get({ $id: planId }) as
		| {
				id: string;
				session_id: string;
				goal: string;
				status: string;
				created_at: string;
				updated_at: string;
		  }
		| undefined;
	if (!row) return null;
	const phases = loadPhases(row.id);
	return {
		id: row.id,
		sessionId: row.session_id,
		goal: row.goal,
		phases,
		status: row.status as PlanStatus,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function loadPhases(planId: string): PlanPhase[] {
	const db = getDb();
	const rows = db
		.query(
			`SELECT id, label, description, status, phase_order, added_at
       FROM chat_plan_phases
       WHERE plan_id = $pid
       ORDER BY phase_order ASC`,
		)
		.all({ $pid: planId }) as Array<{
		id: string;
		label: string;
		description: string;
		status: string;
		phase_order: number;
		added_at: string;
	}>;
	return rows.map((r) => ({
		id: r.id,
		label: r.label,
		description: r.description,
		status: r.status as PlanPhaseStatus,
		order: r.phase_order,
		addedAt: r.added_at,
	}));
}

export function updatePlanStatus(planId: string, status: PlanStatus): void {
	const db = getDb();
	db.query(
		"UPDATE chat_plans SET status = $status, updated_at = $ua WHERE id = $id",
	).run({ $id: planId, $status: status, $ua: nowIso() });
}

export function updatePhaseStatus(
	phaseId: string,
	status: PlanPhaseStatus,
): void {
	const db = getDb();
	db.query("UPDATE chat_plan_phases SET status = $status WHERE id = $id").run({
		$id: phaseId,
		$status: status,
	});
	const row = db
		.query("SELECT plan_id FROM chat_plan_phases WHERE id = $id")
		.get({ $id: phaseId }) as { plan_id: string } | undefined;
	if (row) {
		db.query("UPDATE chat_plans SET updated_at = $ua WHERE id = $id").run({
			$id: row.plan_id,
			$ua: nowIso(),
		});
	}
}

export function addPhase(
	planId: string,
	label: string,
	description: string,
	afterOrder?: number,
): PlanPhase {
	const db = getDb();
	const id = randomUUID();
	const ts = nowIso();
	const maxRow = db
		.query(
			"SELECT MAX(phase_order) as mo FROM chat_plan_phases WHERE plan_id = $pid",
		)
		.get({ $pid: planId }) as { mo: number | null } | undefined;
	const order =
		afterOrder !== undefined ? afterOrder + 1 : (maxRow?.mo ?? -1) + 1;
	db.query(
		`INSERT INTO chat_plan_phases (id, plan_id, label, description, status, phase_order, added_at)
     VALUES ($id, $pid, $label, $desc, $status, $ord, $aa)`,
	).run({
		$id: id,
		$pid: planId,
		$label: label,
		$desc: description,
		$status: "pending",
		$ord: order,
		$aa: ts,
	});
	db.query("UPDATE chat_plans SET updated_at = $ua WHERE id = $id").run({
		$id: planId,
		$ua: ts,
	});
	return {
		id,
		label,
		description,
		status: "pending",
		order,
		addedAt: ts,
	};
}

export function skipPhase(planId: string, phaseId: string): void {
	updatePhaseStatus(phaseId, "skipped");
}

export function cancelPlan(planId: string): void {
	updatePlanStatus(planId, "interrupted");
}
