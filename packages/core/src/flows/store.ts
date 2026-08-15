import { randomUUID } from "node:crypto";
import { daemonLog } from "../logging/daemon-log";
import { getDb } from "../session-store";
import type {
	FlowDefinitionSnapshot,
	FlowDestinationDeliveryRecord,
	FlowNodeDetail,
	FlowNodeStatus,
	FlowRunDetail,
	FlowRunNodeDetail,
	FlowRunStatus,
	FlowRunSummary,
} from "./types";

function nowIso(): string {
	return new Date().toISOString();
}

function safeJsonStringify(value: unknown): string | null {
	if (value === undefined) return null;
	try {
		return JSON.stringify(value);
	} catch {
		return JSON.stringify({
			_error: "json_stringify_failed",
			type: typeof value,
		});
	}
}

function safeJsonParse(raw: string | null | undefined): unknown {
	if (raw == null || raw === "") return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function rowToSummary(row: Record<string, unknown>): FlowRunSummary {
	return {
		id: row.id as string,
		flowName: row.flow_name as string,
		status: row.status as FlowRunStatus,
		personaName: (row.persona_name as string | null) ?? null,
		provider: (row.provider as string | null) ?? null,
		model: (row.model as string | null) ?? null,
		trigger: (row.trigger as string | null) ?? null,
		error: (row.error as string | null) ?? null,
		failedNodeId: (row.failed_node_id as string | null) ?? null,
		startedAt: row.started_at as string,
		completedAt: (row.completed_at as string | null) ?? null,
		durationMs:
			row.duration_ms == null ? null : Number(row.duration_ms as number),
	};
}

function rowToNode(row: Record<string, unknown>): FlowRunNodeDetail {
	return {
		id: row.id as string,
		runId: row.run_id as string,
		nodeId: row.node_id as string,
		nodeType: row.node_type as FlowRunNodeDetail["nodeType"],
		nodeOrder: Number(row.node_order),
		status: row.status as FlowNodeStatus,
		inputs: safeJsonParse(row.inputs_json as string | null),
		outputs: safeJsonParse(row.outputs_json as string | null),
		error: (row.error as string | null) ?? null,
		durationMs:
			row.duration_ms == null ? null : Number(row.duration_ms as number),
		startedAt: (row.started_at as string | null) ?? null,
		completedAt: (row.completed_at as string | null) ?? null,
		detail: safeJsonParse(row.detail_json as string | null),
	};
}

export type CreateFlowRunParams = {
	readonly flowName: string;
	readonly personaName?: string | null;
	readonly provider?: string | null;
	readonly model?: string | null;
	readonly trigger?: string | null;
	readonly definitionSnapshot: FlowDefinitionSnapshot;
	readonly initialInputs?: Readonly<Record<string, unknown>>;
	readonly startedAt?: string;
};

/** Insert a running flow_runs row. Returns run id, or null on persistence failure. */
export function createFlowRun(params: CreateFlowRunParams): string | null {
	try {
		const db = getDb();
		const id = randomUUID();
		const startedAt = params.startedAt ?? nowIso();
		db.query(
			`INSERT INTO flow_runs (
        id, flow_name, status, persona_name, provider, model, trigger,
        definition_snapshot_json, initial_inputs_json, final_outputs_json,
        error, failed_node_id, started_at, completed_at, duration_ms
      ) VALUES (
        $id, $flow_name, 'running', $persona_name, $provider, $model, $trigger,
        $definition_snapshot_json, $initial_inputs_json, NULL,
        NULL, NULL, $started_at, NULL, NULL
      )`,
		).run({
			$id: id,
			$flow_name: params.flowName,
			$persona_name: params.personaName ?? null,
			$provider: params.provider ?? null,
			$model: params.model ?? null,
			$trigger: params.trigger ?? null,
			$definition_snapshot_json: JSON.stringify(params.definitionSnapshot),
			$initial_inputs_json: safeJsonStringify(params.initialInputs ?? {}),
			$started_at: startedAt,
		});
		return id;
	} catch (error) {
		daemonLog("warn", "general", "flow_run_create_failed", {
			flowName: params.flowName,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

export type InsertFlowRunNodeParams = {
	readonly runId: string;
	readonly nodeId: string;
	readonly nodeType: string;
	readonly nodeOrder: number;
	readonly startedAt?: string;
};

/** Insert a node row as running. Returns node row id or null. */
export function insertFlowRunNode(
	params: InsertFlowRunNodeParams,
): string | null {
	try {
		const db = getDb();
		const id = randomUUID();
		const startedAt = params.startedAt ?? nowIso();
		db.query(
			`INSERT INTO flow_run_nodes (
        id, run_id, node_id, node_type, node_order, status,
        inputs_json, outputs_json, error, duration_ms,
        started_at, completed_at, detail_json
      ) VALUES (
        $id, $run_id, $node_id, $node_type, $node_order, 'running',
        NULL, NULL, NULL, NULL,
        $started_at, NULL, NULL
      )`,
		).run({
			$id: id,
			$run_id: params.runId,
			$node_id: params.nodeId,
			$node_type: params.nodeType,
			$node_order: params.nodeOrder,
			$started_at: startedAt,
		});
		return id;
	} catch (error) {
		daemonLog("warn", "general", "flow_run_node_insert_failed", {
			runId: params.runId,
			nodeId: params.nodeId,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

export type CompleteFlowRunNodeParams = {
	readonly id: string;
	readonly status: FlowNodeStatus;
	readonly inputs?: unknown;
	readonly outputs?: unknown;
	readonly detail?: FlowNodeDetail | unknown;
	readonly error?: string | null;
	readonly durationMs: number;
	readonly completedAt?: string;
};

export function completeFlowRunNode(params: CompleteFlowRunNodeParams): void {
	try {
		const db = getDb();
		const completedAt = params.completedAt ?? nowIso();
		db.query(
			`UPDATE flow_run_nodes SET
        status = $status,
        inputs_json = $inputs_json,
        outputs_json = $outputs_json,
        detail_json = $detail_json,
        error = $error,
        duration_ms = $duration_ms,
        completed_at = $completed_at
      WHERE id = $id`,
		).run({
			$id: params.id,
			$status: params.status,
			$inputs_json: safeJsonStringify(params.inputs ?? null),
			$outputs_json: safeJsonStringify(params.outputs ?? null),
			$detail_json: safeJsonStringify(params.detail ?? null),
			$error: params.error ?? null,
			$duration_ms: params.durationMs,
			$completed_at: completedAt,
		});
	} catch (error) {
		daemonLog("warn", "general", "flow_run_node_complete_failed", {
			id: params.id,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export type CompleteFlowRunParams = {
	readonly id: string;
	readonly status: "success" | "error";
	readonly finalOutputs?: unknown;
	readonly error?: string | null;
	readonly failedNodeId?: string | null;
	readonly durationMs: number;
	readonly completedAt?: string;
};

export function completeFlowRun(params: CompleteFlowRunParams): void {
	try {
		const db = getDb();
		const completedAt = params.completedAt ?? nowIso();
		db.query(
			`UPDATE flow_runs SET
        status = $status,
        final_outputs_json = $final_outputs_json,
        error = $error,
        failed_node_id = $failed_node_id,
        completed_at = $completed_at,
        duration_ms = $duration_ms
      WHERE id = $id`,
		).run({
			$id: params.id,
			$status: params.status,
			$final_outputs_json: safeJsonStringify(params.finalOutputs ?? null),
			$error: params.error ?? null,
			$failed_node_id: params.failedNodeId ?? null,
			$completed_at: completedAt,
			$duration_ms: params.durationMs,
		});
	} catch (error) {
		daemonLog("warn", "general", "flow_run_complete_failed", {
			id: params.id,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export function getFlowRun(id: string): FlowRunDetail | null {
	const db = getDb();
	const row = db
		.query(
			`SELECT id, flow_name, status, persona_name, provider, model, trigger,
        definition_snapshot_json, initial_inputs_json, final_outputs_json,
        destination_results_json,
        error, failed_node_id, started_at, completed_at, duration_ms
       FROM flow_runs WHERE id = $id`,
		)
		.get({ $id: id }) as Record<string, unknown> | undefined;
	if (!row) return null;

	const nodeRows = db
		.query(
			`SELECT id, run_id, node_id, node_type, node_order, status,
        inputs_json, outputs_json, error, duration_ms,
        started_at, completed_at, detail_json
       FROM flow_run_nodes
       WHERE run_id = $run_id
       ORDER BY node_order ASC`,
		)
		.all({ $run_id: id }) as Array<Record<string, unknown>>;

	const snapshot = safeJsonParse(
		row.definition_snapshot_json as string,
	) as FlowDefinitionSnapshot | null;

	const summary = rowToSummary(row);
	const destinationParsed = safeJsonParse(
		row.destination_results_json as string | null,
	);
	const destinationResults = Array.isArray(destinationParsed)
		? (destinationParsed as FlowDestinationDeliveryRecord[])
		: null;
	return {
		...summary,
		definitionSnapshot: snapshot ?? { name: summary.flowName, nodes: [] },
		initialInputs: safeJsonParse(row.initial_inputs_json as string | null),
		finalOutputs: safeJsonParse(row.final_outputs_json as string | null),
		destinationResults,
		nodes: nodeRows.map(rowToNode),
	};
}

export function completeFlowRunDestinations(params: {
	readonly id: string;
	readonly destinationResults: readonly FlowDestinationDeliveryRecord[];
	readonly error?: string | null;
}): void {
	try {
		const db = getDb();
		const failed = Boolean(params.error);
		db.query(
			`UPDATE flow_runs SET
        destination_results_json = $destination_results_json
        ${failed ? ", status = 'error', error = $error" : ""}
      WHERE id = $id`,
		).run({
			$id: params.id,
			$destination_results_json: safeJsonStringify(params.destinationResults),
			...(failed ? { $error: params.error } : {}),
		});
	} catch (error) {
		daemonLog("warn", "general", "flow_run_destinations_failed", {
			id: params.id,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/** Newest successful run for a flow, or null. */
export function getLatestSuccessfulFlowRun(
	flowName: string,
): FlowRunDetail | null {
	const key = flowName.trim();
	if (!key) return null;
	const db = getDb();
	const row = db
		.query(
			`SELECT id FROM flow_runs
       WHERE flow_name = $flow_name AND status = 'success'
       ORDER BY COALESCE(completed_at, started_at) DESC
       LIMIT 1`,
		)
		.get({ $flow_name: key }) as { id?: string } | undefined;
	if (!row?.id) return null;
	return getFlowRun(row.id);
}

export function listFlowRuns(params?: {
	readonly flowName?: string;
	readonly limit?: number;
	readonly offset?: number;
}): readonly FlowRunSummary[] {
	const db = getDb();
	const limit = Math.min(Math.max(params?.limit ?? 50, 1), 200);
	const offset = Math.max(params?.offset ?? 0, 0);
	const flowName = params?.flowName?.trim();

	const rows = (
		flowName
			? (db
					.query(
						`SELECT id, flow_name, status, persona_name, provider, model, trigger,
              error, failed_node_id, started_at, completed_at, duration_ms
             FROM flow_runs
             WHERE flow_name = $flow_name
             ORDER BY started_at DESC
             LIMIT $limit OFFSET $offset`,
					)
					.all({
						$flow_name: flowName,
						$limit: limit,
						$offset: offset,
					}) as Array<Record<string, unknown>>)
			: (db
					.query(
						`SELECT id, flow_name, status, persona_name, provider, model, trigger,
              error, failed_node_id, started_at, completed_at, duration_ms
             FROM flow_runs
             ORDER BY started_at DESC
             LIMIT $limit OFFSET $offset`,
					)
					.all({ $limit: limit, $offset: offset }) as Array<
					Record<string, unknown>
				>)
	).map(rowToSummary);

	return rows;
}

export function deleteFlowRun(id: string): boolean {
	const db = getDb();
	const result = db
		.query("DELETE FROM flow_runs WHERE id = $id")
		.run({ $id: id }) as { changes?: number };
	return (result.changes ?? 0) > 0;
}

/**
 * Delete completed runs started before `olderThanIso` (ISO-8601).
 * Running rows are never deleted. Returns number of deleted runs.
 *
 * Enables future purge of old execution history by wall-clock time.
 */
export function pruneFlowRuns(params: {
	readonly olderThanIso: string;
	readonly flowName?: string;
}): number {
	const db = getDb();
	const flowName = params.flowName?.trim();
	const result = (
		flowName
			? db
					.query(
						`DELETE FROM flow_runs
           WHERE status != 'running'
             AND started_at < $older_than
             AND flow_name = $flow_name`,
					)
					.run({
						$older_than: params.olderThanIso,
						$flow_name: flowName,
					})
			: db
					.query(
						`DELETE FROM flow_runs
           WHERE status != 'running'
             AND started_at < $older_than`,
					)
					.run({ $older_than: params.olderThanIso })
	) as { changes?: number };
	return result.changes ?? 0;
}
