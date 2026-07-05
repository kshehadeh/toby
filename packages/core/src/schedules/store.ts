import { randomUUID } from "node:crypto";
import { getDb } from "../session-store";
import type {
	CreateScheduleParams,
	Schedule,
	ScheduleRun,
	ScheduleRunStatus,
	UpdateScheduleParams,
} from "./types";

function nowIso(): string {
	return new Date().toISOString();
}

function rowToSchedule(row: Record<string, unknown>): Schedule {
	return {
		id: row.id as string,
		name: row.name as string,
		prompt: row.prompt as string,
		personaName: row.persona_name as string,
		cronExpression: row.cron_expression as string,
		projectId: (row.project_id as string | null) ?? null,
		enabled: Boolean(row.enabled),
		lastRunAt: (row.last_run_at as string | null) ?? null,
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	};
}

function rowToScheduleRun(row: Record<string, unknown>): ScheduleRun {
	return {
		id: row.id as string,
		scheduleId: row.schedule_id as string,
		personaName: row.persona_name as string,
		prompt: row.prompt as string,
		output: (row.output as string | null) ?? null,
		transcript: (row.transcript as string | null) ?? null,
		status: row.status as ScheduleRunStatus,
		error: (row.error as string | null) ?? null,
		startedAt: row.started_at as string,
		completedAt: (row.completed_at as string | null) ?? null,
	};
}

export function listSchedules(): Schedule[] {
	const db = getDb();
	const rows = db
		.query(
			`SELECT id, name, prompt, persona_name, cron_expression, project_id, enabled, last_run_at, created_at, updated_at
       FROM schedules
       ORDER BY created_at DESC`,
		)
		.all() as Array<Record<string, unknown>>;
	return rows.map(rowToSchedule);
}

function getSchedule(id: string): Schedule | null {
	const db = getDb();
	const row = db
		.query(
			`SELECT id, name, prompt, persona_name, cron_expression, project_id, enabled, last_run_at, created_at, updated_at
       FROM schedules
       WHERE id = $id`,
		)
		.get({ $id: id }) as Record<string, unknown> | undefined;
	if (!row) return null;
	return rowToSchedule(row);
}

export function createSchedule(params: CreateScheduleParams): Schedule {
	const db = getDb();
	const id = randomUUID();
	const ts = nowIso();
	const enabled = params.enabled !== false ? 1 : 0;
	db.query(
		`INSERT INTO schedules (id, name, prompt, persona_name, cron_expression, project_id, enabled, last_run_at, created_at, updated_at)
     VALUES ($id, $name, $prompt, $persona_name, $cron_expression, $project_id, $enabled, NULL, $created_at, $updated_at)`,
	).run({
		$id: id,
		$name: params.name.trim(),
		$prompt: params.prompt.trim(),
		$persona_name: params.personaName.trim(),
		$cron_expression: params.cronExpression.trim(),
		$project_id: params.projectId?.trim() || null,
		$enabled: enabled,
		$created_at: ts,
		$updated_at: ts,
	});
	return getSchedule(id) as Schedule;
}

export function updateSchedule(
	id: string,
	params: UpdateScheduleParams,
): Schedule | null {
	const existing = getSchedule(id);
	if (!existing) return null;

	const db = getDb();
	const name = params.name?.trim() ?? existing.name;
	const prompt = params.prompt?.trim() ?? existing.prompt;
	const personaName = params.personaName?.trim() ?? existing.personaName;
	const cronExpression =
		params.cronExpression?.trim() ?? existing.cronExpression;
	const projectId =
		params.projectId !== undefined
			? params.projectId?.trim() || null
			: existing.projectId;
	const enabled =
		params.enabled !== undefined
			? params.enabled
				? 1
				: 0
			: existing.enabled
				? 1
				: 0;

	db.query(
		`UPDATE schedules
     SET name = $name, prompt = $prompt, persona_name = $persona_name,
         cron_expression = $cron_expression, project_id = $project_id,
         enabled = $enabled, updated_at = $updated_at
     WHERE id = $id`,
	).run({
		$id: id,
		$name: name,
		$prompt: prompt,
		$persona_name: personaName,
		$cron_expression: cronExpression,
		$project_id: projectId,
		$enabled: enabled,
		$updated_at: nowIso(),
	});

	return getSchedule(id);
}

export function deleteSchedule(id: string): boolean {
	const db = getDb();
	const row = db
		.query("SELECT id FROM schedules WHERE id = $id")
		.get({ $id: id }) as Record<string, unknown> | undefined;
	if (!row) return false;
	db.query("DELETE FROM schedules WHERE id = $id").run({ $id: id });
	return true;
}

export function getDueSchedules(): Schedule[] {
	const db = getDb();
	const rows = db
		.query(
			`SELECT id, name, prompt, persona_name, cron_expression, project_id, enabled, last_run_at, created_at, updated_at
       FROM schedules
       WHERE enabled = 1`,
		)
		.all() as Array<Record<string, unknown>>;
	return rows.map(rowToSchedule);
}

export function updateScheduleLastRun(id: string): void {
	const db = getDb();
	db.query(
		"UPDATE schedules SET last_run_at = $last_run_at, updated_at = $updated_at WHERE id = $id",
	).run({
		$id: id,
		$last_run_at: nowIso(),
		$updated_at: nowIso(),
	});
}

export function claimScheduleRun(
	id: string,
	lastRunAt: string | null,
): boolean {
	const db = getDb();
	const ts = nowIso();
	const params: Record<string, unknown> = {
		$id: id,
		$last_run_at: ts,
		$updated_at: ts,
	};
	const lastRunWhere =
		lastRunAt === null ? "last_run_at IS NULL" : "last_run_at = $expected";
	if (lastRunAt !== null) {
		params.$expected = lastRunAt;
	}
	const result = db
		.query(
			`UPDATE schedules
       SET last_run_at = $last_run_at, updated_at = $updated_at
       WHERE id = $id AND enabled = 1 AND ${lastRunWhere}`,
		)
		.run(params);
	return Number((result as { changes: number } | null)?.changes ?? 0) > 0;
}

export function createScheduleRun(params: {
	scheduleId: string;
	personaName: string;
	prompt: string;
}): string {
	const db = getDb();
	const id = randomUUID();
	const ts = nowIso();
	db.query(
		`INSERT INTO schedule_runs (id, schedule_id, persona_name, prompt, output, status, error, started_at, completed_at)
     VALUES ($id, $schedule_id, $persona_name, $prompt, NULL, 'running', NULL, $started_at, NULL)`,
	).run({
		$id: id,
		$schedule_id: params.scheduleId,
		$persona_name: params.personaName,
		$prompt: params.prompt,
		$started_at: ts,
	});
	return id;
}

export function completeScheduleRun(
	runId: string,
	result:
		| { status: "success"; output: string }
		| { status: "error"; error: string },
): void {
	const db = getDb();
	const ts = nowIso();
	if (result.status === "success") {
		db.query(
			`UPDATE schedule_runs
       SET status = 'success', output = $output, completed_at = $completed_at
       WHERE id = $id`,
		).run({
			$id: runId,
			$output: result.output,
			$completed_at: ts,
		});
	} else {
		db.query(
			`UPDATE schedule_runs
       SET status = 'error', error = $error, completed_at = $completed_at
       WHERE id = $id`,
		).run({
			$id: runId,
			$error: result.error,
			$completed_at: ts,
		});
	}
}

export function listScheduleRuns(
	scheduleId: string,
	limit = 20,
): ScheduleRun[] {
	const db = getDb();
	const rows = db
		.query(
			`SELECT id, schedule_id, persona_name, prompt, output, transcript, status, error, started_at, completed_at
       FROM schedule_runs
       WHERE schedule_id = $schedule_id
       ORDER BY started_at DESC
       LIMIT $limit`,
		)
		.all({
			$schedule_id: scheduleId,
			$limit: Math.max(1, Math.min(500, limit)),
		}) as Array<Record<string, unknown>>;
	return rows.map(rowToScheduleRun);
}

export function getScheduleRun(id: string): ScheduleRun | null {
	const db = getDb();
	const row = db
		.query(
			`SELECT id, schedule_id, persona_name, prompt, output, transcript, status, error, started_at, completed_at
       FROM schedule_runs
       WHERE id = $id`,
		)
		.get({ $id: id }) as Record<string, unknown> | undefined;
	if (!row) return null;
	return rowToScheduleRun(row);
}

export function updateScheduleRunTranscript(
	runId: string,
	transcript: string,
): void {
	const db = getDb();
	db.query(
		`UPDATE schedule_runs
     SET transcript = $transcript
     WHERE id = $id`,
	).run({
		$id: runId,
		$transcript: transcript,
	});
}
