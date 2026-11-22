import { createHash } from "node:crypto";
import { readConfig } from "../config/index";
import { isWithinActiveHours } from "../feed/schedule-config";
import { runGraphEnrichment } from "../graph/enrichment";
import type { GraphExtract } from "../graph/enrichment";
import { backfillMemoryGraph } from "../graph/memory-backfill";
import { neighbors } from "../graph/query";
import { edgesTouching, getNode, upsertEdgeByIds } from "../graph/store";
import { writeGraph } from "../graph/write";
import { daemonLog } from "../logging/daemon-log";
import { nativeAppRequest } from "../native-app/client";
import { pruneObservations, runObservationIngest } from "../observations/run";
import { listObservationSources } from "../observations/sources";
import { getObservationByNode } from "../observations/store";
import {
	createTodo,
	deleteTodo,
	getTodo,
	listOrganization,
	saveOrganization,
	todoHistory,
	transitionTodo,
} from "../todos/service";
import {
	evaluateFollowupUnits,
	extractGraphEntities,
	resolveEvaluatorModel,
} from "./model";
import {
	claimEvaluationBudget,
	createFollowupLoop,
	findFollowupByFingerprint,
	getEvaluatedUnitHash,
	getFollowupLoop,
	getFollowupMeta,
	listFollowupLoops,
	markUnitEvaluated,
	recordFollowupFeedback,
	refundEvaluationBudget,
	setFollowupMeta,
	setFollowupTodoId,
	updateFollowupLoop,
} from "./store";
import { followupEvaluationSchema } from "./types";
import type { FollowupLoop, FollowupUnit } from "./types";
import {
	buildFollowupUnits,
	changedFollowupUnits,
	followupWaitDays,
} from "./units";

const DEFAULT_INTERVAL_MINUTES = 30;
const DEFAULT_EVALUATION_BUDGET = 200;
const DEFAULT_OPEN_THRESHOLD = 0.75;
const DEFAULT_CLOSE_THRESHOLD = 0.85;
const EXPIRE_DAYS = 30;
const STARTUP_DELAY_MS = 60_000;
const EVALUATION_BATCH_SIZE = 8;

export interface FollowupsRunStats {
	readonly status: "disabled" | "setup_required" | "ok" | "error";
	readonly ingested: number;
	readonly enriched: number;
	readonly reconciled: number;
	readonly candidates: number;
	readonly evaluated: number;
	readonly opened: number;
	readonly closed: number;
	readonly error?: string;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function followupTodoId(fingerprint: string): string {
	return `toby-followup-${sha256(fingerprint).slice(0, 40)}`;
}

function followupFingerprint(
	kind: string,
	unit: FollowupUnit,
	title: string,
): string {
	return sha256(
		`${kind}|${unit.unitId}|${title.trim().toLowerCase()}|${unit.evidenceHash}`,
	);
}

function ensureOrganization(kind: "list" | "tag", name: string): string {
	const existing = listOrganization(kind).find(
		(item) =>
			"name" in item && item.name.trim().toLowerCase() === name.toLowerCase(),
	);
	if (existing) return String(existing.id);
	const created = saveOrganization(
		kind,
		{ name },
		{
			source: "followups",
			idempotencyKey: `followups:organization:${kind}:${name.toLowerCase()}`,
		},
	) as { id: string };
	return created.id;
}

function evidenceUrl(nodeId: string): string | undefined {
	const observation = getObservationByNode(nodeId);
	return observation?.url;
}

function evidenceActivityAt(ids: readonly string[], fallback: string): string {
	let latest = Date.parse(fallback);
	for (const id of ids) {
		const occurredAt = Date.parse(getObservationByNode(id)?.occurredAt ?? "");
		if (Number.isFinite(occurredAt)) latest = Math.max(latest, occurredAt);
	}
	return new Date(latest).toISOString();
}

function addEvidenceEdges(
	loopId: string,
	evidence: readonly string[],
	reason: string,
	confidence: number,
): void {
	const loop = getNode(loopId);
	if (!loop) return;
	for (const evidenceId of evidence) {
		if (!getNode(evidenceId)) continue;
		upsertEdgeByIds(loopId, evidenceId, {
			type: "evidence_for",
			origin: "extracted",
			confidence,
			weight: confidence,
			reason,
		});
		for (const edge of edgesTouching([evidenceId], { fanout: 100 })) {
			const relatedId = edge.src === evidenceId ? edge.dst : edge.src;
			const related = getNode(relatedId);
			if (
				!related ||
				related.visibility !== "usable_by_ai" ||
				!["person", "org", "project", "topic", "thread", "event"].includes(
					related.type,
				)
			)
				continue;
			upsertEdgeByIds(loopId, relatedId, {
				type: "about",
				origin: "deterministic",
				provenanceNodeId: evidenceId,
				weight: edge.weight,
				confidence: edge.confidence,
			});
		}
	}
}

function createTodoForLoop(params: {
	loopId: string;
	fingerprint: string;
	kind: string;
	title: string;
	confidence: number;
	counterpart?: string;
	due?: string;
	evidenceIds: readonly string[];
}): string {
	const listId = ensureOrganization("list", "From Toby");
	const autoTagId = ensureOrganization("tag", "auto");
	const todoId = followupTodoId(params.fingerprint);
	let existing: ReturnType<typeof getTodo> | null = null;
	try {
		existing = getTodo(todoId);
	} catch {
		/* The deterministic todo has not been created yet. */
	}
	if (!existing) {
		const link = params.evidenceIds
			.map(evidenceUrl)
			.find((value) => Boolean(value));
		const details = [
			`Toby added this because it found evidence of ${params.kind.replaceAll("_", " ")}${params.counterpart ? ` involving ${params.counterpart}` : ""}.`,
			link ? `Source: ${link}` : "",
		]
			.filter(Boolean)
			.join("\n");
		try {
			createTodo(
				{
					title: params.title,
					description: details,
					listId,
					tags: [autoTagId],
					...(params.due
						? {
								due: {
									date: new Date(params.due).toISOString().slice(0, 10),
									time: new Date(params.due).toISOString().slice(11, 16),
									timezone: "UTC",
								},
							}
						: {}),
				},
				{
					source: "followups",
					idempotencyKey: `followup:${params.loopId}`,
					internalTodoId: todoId,
				},
			);
		} catch (error) {
			try {
				getTodo(todoId);
			} catch {
				throw error;
			}
		}
	}
	const todo = getTodo(todoId);
	const todoNode = {
		type: "todo" as const,
		key: todoId,
		label: todo.title,
		props: { source: "followups", status: todo.state.status },
	};
	const loopNode = getNode(params.loopId);
	if (loopNode) {
		writeGraph({
			nodes: [todoNode],
			edges: [
				{
					src: todoNode,
					dst: { type: "loop", key: loopNode.key },
					type: "tracks",
				},
			],
		});
	}
	setFollowupTodoId(params.loopId, todoId);
	return todoId;
}

function openFollowup(params: {
	unit: FollowupUnit;
	now: Date;
	kind: "owe_reply" | "awaiting_reply" | "commitment";
	title: string;
	counterpart?: string;
	due?: string;
	confidence: number;
	evidenceIds: readonly string[];
}): FollowupLoop | null {
	const evidence = params.evidenceIds.filter(
		(id) => params.unit.nodeIds.includes(id) && getNode(id),
	);
	if (evidence.length === 0) return null;
	const active = params.unit.loopIds
		.map((id) => getFollowupLoop(id))
		.find(
			(loop) =>
				loop?.status === "open" &&
				loop.kind === params.kind &&
				loop.title.trim().toLowerCase() === params.title.trim().toLowerCase(),
		);
	if (active) {
		const linkedEvidence = new Set(
			edgesTouching([active.loopId], {
				edgeTypes: ["evidence_for"],
				fanout: 1000,
			})
				.filter((edge) => edge.src === active.loopId)
				.map((edge) => edge.dst),
		);
		const newEvidence = evidence.filter((id) => !linkedEvidence.has(id));
		if (newEvidence.length === 0) return active;
		addEvidenceEdges(
			active.loopId,
			newEvidence,
			`New evidence supporting ${params.kind.replaceAll("_", " ")}.`,
			params.confidence,
		);
		const lastActivityAt = evidenceActivityAt(
			newEvidence,
			active.lastActivityAt,
		);
		if (lastActivityAt === active.lastActivityAt) return active;
		return updateFollowupLoop(active.loopId, { lastActivityAt }) ?? active;
	}
	const fingerprint = followupFingerprint(
		params.kind,
		params.unit,
		params.title,
	);
	const prior = findFollowupByFingerprint(fingerprint);
	if (prior) return prior;
	const loopInput = {
		type: "loop" as const,
		key: fingerprint,
		label: params.title,
		props: {
			kind: params.kind,
			status: "open",
			title: params.title,
			...(params.counterpart ? { counterpart: params.counterpart } : {}),
			...(params.due ? { dueAt: params.due } : {}),
		},
	};
	const loopId = writeGraph({ nodes: [loopInput] }).nodeIds[0];
	if (!loopId) return null;
	const lastActivityAt = evidenceActivityAt(evidence, params.now.toISOString());
	const row = createFollowupLoop({
		loopId,
		kind: params.kind,
		fingerprint,
		title: params.title,
		...(params.counterpart ? { counterpart: params.counterpart } : {}),
		...(params.due ? { dueAt: params.due } : {}),
		confidence: params.confidence,
		lastActivityAt,
	});
	addEvidenceEdges(
		row.loopId,
		evidence,
		`Evidence supporting ${params.kind.replaceAll("_", " ")}.`,
		params.confidence,
	);
	const todoId = createTodoForLoop({
		loopId: row.loopId,
		fingerprint,
		kind: params.kind,
		title: params.title,
		confidence: params.confidence,
		counterpart: params.counterpart,
		due: params.due,
		evidenceIds: evidence,
	});
	return updateFollowupLoop(row.loopId, { todoId }) ?? row;
}

function applyEvaluations(
	units: readonly FollowupUnit[],
	raw: unknown,
	now: Date,
): {
	opened: number;
	closed: number;
	closedTitles: string[];
	processed: number;
} {
	const result = followupEvaluationSchema.safeParse(raw);
	if (!result.success)
		throw new Error("Follow-up evaluator response failed validation");
	const byId = new Map(result.data.units.map((item) => [item.unitId, item]));
	let opened = 0;
	let closed = 0;
	let processed = 0;
	const closedTitles: string[] = [];
	const openThreshold =
		readConfig().followups?.thresholds?.open ?? DEFAULT_OPEN_THRESHOLD;
	const closeThreshold =
		readConfig().followups?.thresholds?.close ?? DEFAULT_CLOSE_THRESHOLD;
	const enabledKinds = readConfig().followups?.kinds;
	for (const unit of units) {
		const evaluation = byId.get(unit.unitId);
		if (!evaluation) continue;
		processed++;
		for (const item of unit.unitId.startsWith("open:") ? evaluation.open : []) {
			if (
				item.confidence < openThreshold ||
				enabledKinds?.[
					item.kind === "owe_reply"
						? "oweReply"
						: item.kind === "awaiting_reply"
							? "awaitingReply"
							: "commitment"
				] === false
			)
				continue;
			const fingerprint = followupFingerprint(item.kind, unit, item.title);
			const existed =
				findFollowupByFingerprint(fingerprint) !== null ||
				unit.loopIds.some((loopId) => {
					const candidate = getFollowupLoop(loopId);
					return (
						candidate?.status === "open" &&
						candidate.kind === item.kind &&
						candidate.title.trim().toLowerCase() ===
							item.title.trim().toLowerCase()
					);
				});
			const loop = openFollowup({ unit, now, ...item });
			if (loop && !existed) opened++;
		}
		for (const item of evaluation.close) {
			if (
				item.confidence < closeThreshold ||
				!unit.loopIds.includes(item.loopId) ||
				!unit.nodeIds.includes(item.evidenceId)
			)
				continue;
			const loop = listFollowupLoops({ status: "open", limit: 1000 }).find(
				(candidate) => candidate.loopId === item.loopId,
			);
			if (!loop) continue;
			if (loop.resolutionRejected) {
				const evidence = getObservationByNode(item.evidenceId);
				const rejectedAt = Date.parse(loop.reopenedAt ?? loop.lastActivityAt);
				const occurredAt = Date.parse(evidence?.occurredAt ?? "");
				const ingestedAt = Date.parse(evidence?.ingestedAt ?? "");
				if (
					!evidence ||
					!Number.isFinite(rejectedAt) ||
					!Number.isFinite(occurredAt) ||
					!Number.isFinite(ingestedAt) ||
					occurredAt <= rejectedAt ||
					ingestedAt <= rejectedAt
				)
					continue;
			}
			if (readConfig().followups?.autoComplete !== false && loop.todoId) {
				const todo = getTodo(loop.todoId);
				if (!todo.deleted && todo.state.status === "open") {
					transitionTodo(
						todo.id,
						"complete",
						{ allowIncompleteChecklist: true },
						{
							source: "followups",
							expectedRevision: todo.revision,
						},
					);
					closedTitles.push(loop.title);
				}
			}
			addEvidenceEdges(
				loop.loopId,
				[item.evidenceId],
				item.reason,
				item.confidence,
			);
			updateFollowupLoop(
				loop.loopId,
				{ status: "resolved", lastActivityAt: now.toISOString() },
				now.toISOString(),
			);
			const loopNode = getNode(loop.loopId);
			if (loopNode)
				writeGraph({
					nodes: [
						{ type: "loop", key: loopNode.key, props: { status: "resolved" } },
					],
				});
			closed++;
		}
		for (const loopId of unit.loopIds) {
			const loop = listFollowupLoops({ status: "open", limit: 1000 }).find(
				(candidate) => candidate.loopId === loopId,
			);
			if (loop) updateFollowupLoop(loopId, { lastEvaluatedHash: unit.hash });
		}
		markUnitEvaluated(unit.unitId, unit.hash, now.toISOString());
	}
	return { opened, closed, closedTitles, processed };
}

export function reconcileFollowupLoops(now = new Date()): number {
	const loops = [
		...listFollowupLoops({ status: "open", limit: 1000 }),
		...listFollowupLoops({ status: "resolved", limit: 1000 }),
	];
	let changed = 0;
	for (const loop of loops) {
		const expireIfInactive = () => {
			if (loop.status !== "open") return;
			const sources = readConfig().followups?.sources ?? {};
			const activityIds = neighbors(loop.loopId, {
				depth: 2,
				nodeTypes: ["observation", "event", "todo"],
				limit: 200,
			})
				.filter(({ node }) => {
					const observation = getObservationByNode(node.id);
					return (
						observation &&
						sources[observation.sourceId] !== false &&
						Date.parse(observation.occurredAt) <= now.getTime()
					);
				})
				.map(({ node }) => node.id);
			const lastActivityAt = evidenceActivityAt(
				activityIds,
				loop.lastActivityAt,
			);
			if (
				now.getTime() - Date.parse(lastActivityAt) >=
				EXPIRE_DAYS * 86_400_000
			) {
				updateFollowupLoop(
					loop.loopId,
					{ status: "expired" },
					now.toISOString(),
				);
				setGraphLoopStatus(loop.loopId, "expired");
				changed++;
			} else if (lastActivityAt !== loop.lastActivityAt) {
				updateFollowupLoop(loop.loopId, { lastActivityAt });
				changed++;
			}
		};
		if (!loop.todoId) {
			expireIfInactive();
			continue;
		}
		let todo: ReturnType<typeof getTodo>;
		try {
			todo = getTodo(loop.todoId);
		} catch {
			expireIfInactive();
			continue;
		}
		if (todo.deleted) {
			updateFollowupLoop(
				loop.loopId,
				{ status: "dismissed" },
				now.toISOString(),
			);
			setGraphLoopStatus(loop.loopId, "dismissed");
			recordFollowupFeedback({
				fingerprint: loop.fingerprint,
				outcome: "dismissed",
				reason: "Todo deleted",
			});
			changed++;
			continue;
		}
		const history = todoHistory(loop.todoId);
		const hasState = (
			op: (typeof history)[number],
			status: "open" | "completed",
		) =>
			op.changes.some(
				(change) =>
					change.kind === "occurrence" &&
					change.fields.state &&
					(change.fields.state as { status?: string }).status === status,
			);
		const lastFollowupComplete = history
			.map((op, index) => ({ op, index }))
			.filter(
				({ op }) => op.source === "followups" && hasState(op, "completed"),
			)
			.at(-1);
		const reopenOperation = lastFollowupComplete
			? history
					.slice(lastFollowupComplete.index + 1)
					.filter((op) => op.source !== "followups" && hasState(op, "open"))
					.at(-1)
			: undefined;
		if (
			todo.state.status === "open" &&
			reopenOperation &&
			(loop.status === "resolved" ||
				!loop.resolutionRejected ||
				loop.reopenedAt !== reopenOperation.at)
		) {
			updateFollowupLoop(
				loop.loopId,
				{
					status: "open",
					resolutionRejected: true,
					reopenedAt: reopenOperation.at,
					lastActivityAt: reopenOperation.at,
				},
				reopenOperation.at,
			);
			setGraphLoopStatus(loop.loopId, "open");
			recordFollowupFeedback({
				fingerprint: loop.fingerprint,
				outcome: "reopened",
				reason: "User reopened auto-completed todo",
			});
			changed++;
			continue;
		}
		if (todo.state.status === "completed") {
			const lastCompletion = history
				.filter((op) => hasState(op, "completed"))
				.at(-1);
			if (loop.status === "open" && lastCompletion?.source !== "followups") {
				updateFollowupLoop(
					loop.loopId,
					{ status: "resolved" },
					now.toISOString(),
				);
				setGraphLoopStatus(loop.loopId, "resolved");
				changed++;
				continue;
			}
		}
		expireIfInactive();
	}
	return changed;
}

export function setGraphLoopStatus(loopId: string, status: string): void {
	const node = getNode(loopId);
	if (node)
		writeGraph({ nodes: [{ type: "loop", key: node.key, props: { status } }] });
}

export function recordFollowupNotUseful(id: string): boolean {
	const loop = getNode(id)
		? listFollowupLoops({ limit: 1000 }).find((item) => item.loopId === id)
		: null;
	if (!loop) return false;
	if (loop.todoId) {
		const todo = getTodo(loop.todoId);
		if (!todo.deleted)
			deleteTodo(todo.id, false, {
				source: "followups",
				expectedRevision: todo.revision,
			});
	}
	updateFollowupLoop(loop.loopId, { status: "dismissed" });
	setGraphLoopStatus(loop.loopId, "dismissed");
	recordFollowupFeedback({
		fingerprint: loop.fingerprint,
		outcome: "not_useful",
	});
	return true;
}

export function reopenFollowupTodo(id: string): boolean {
	const loop = getNode(id)
		? listFollowupLoops({ limit: 1000 }).find((item) => item.loopId === id)
		: null;
	const byTodo =
		loop ??
		listFollowupLoops({ limit: 1000 }).find((item) => item.todoId === id);
	if (!byTodo?.todoId) return false;
	const todo = getTodo(byTodo.todoId);
	if (todo.state.status !== "completed") return false;
	transitionTodo(
		todo.id,
		"reopen",
		{ sequence: todo.sequence },
		{ source: "followups", expectedRevision: todo.revision },
	);
	const reopenedAt = new Date().toISOString();
	updateFollowupLoop(
		byTodo.loopId,
		{
			status: "open",
			resolutionRejected: true,
			reopenedAt,
			lastActivityAt: reopenedAt,
		},
		reopenedAt,
	);
	setGraphLoopStatus(byTodo.loopId, "open");
	recordFollowupFeedback({
		fingerprint: byTodo.fingerprint,
		outcome: "reopened",
	});
	return true;
}

async function notifyCompleted(titles: readonly string[]): Promise<void> {
	if (!titles.length || readConfig().followups?.notifications === false) return;
	await nativeAppRequest("feed/notification", {
		body: {
			title:
				titles.length === 1
					? "Toby completed a follow-up"
					: `Toby completed ${titles.length} follow-ups`,
			body: titles.slice(0, 3).join(", "),
		},
		launch: false,
		timeoutMs: 5000,
	});
}

export async function runFollowupsOnce(
	params: {
		readonly now?: Date;
		readonly evaluate?: (units: readonly FollowupUnit[]) => Promise<unknown>;
		readonly extract?: GraphExtract;
		readonly includeIngest?: boolean;
	} = {},
): Promise<FollowupsRunStats> {
	const now = params.now ?? new Date();
	const config = readConfig().followups;
	if (config?.enabled === false)
		return {
			status: "disabled",
			ingested: 0,
			enriched: 0,
			reconciled: 0,
			candidates: 0,
			evaluated: 0,
			opened: 0,
			closed: 0,
		};
	try {
		const migration = backfillMemoryGraph();
		const sourceStats =
			params.includeIngest === false
				? []
				: await runObservationIngest({
						now,
						sources: await listObservationSources(),
					});
		const reconciled = reconcileFollowupLoops(now);
		const pruned = pruneObservations(now);
		const model = params.evaluate
			? { ok: true as const }
			: await resolveEvaluatorModel();
		const enrichment = await runGraphEnrichment({
			now,
			extract: params.extract ?? (model.ok ? extractGraphEntities : undefined),
		});
		if (!model.ok)
			return {
				status: "setup_required",
				ingested: sourceStats.reduce(
					(total, source) => total + source.created + source.updated,
					0,
				),
				enriched: enrichment.processed,
				reconciled,
				candidates: 0,
				evaluated: 0,
				opened: 0,
				closed: 0,
				error: model.reason,
			};
		const previous = getFollowupMeta("last_run_at");
		const since =
			previous ?? new Date(now.getTime() - 14 * 86_400_000).toISOString();
		const allUnits = buildFollowupUnits({ since, now });
		const units = changedFollowupUnits(allUnits, getEvaluatedUnitHash);
		const maxBudget = config?.maxEvaluationsPerDay ?? DEFAULT_EVALUATION_BUDGET;
		let evaluated = 0;
		let processed = 0;
		let opened = 0;
		let closed = 0;
		const completedTitles: string[] = [];
		for (let i = 0; i < units.length; ) {
			const batchLimit = claimEvaluationBudget(
				Math.min(EVALUATION_BATCH_SIZE, units.length - i),
				maxBudget,
				now,
			);
			if (batchLimit === 0) break;
			const batch = units.slice(i, i + batchLimit);
			let result: ReturnType<typeof applyEvaluations>;
			try {
				const raw = await (params.evaluate ?? evaluateFollowupUnits)(batch);
				result = applyEvaluations(batch, raw, now);
			} catch (error) {
				refundEvaluationBudget(batch.length, now);
				throw error;
			}
			opened += result.opened;
			closed += result.closed;
			completedTitles.push(...result.closedTitles);
			evaluated += result.processed;
			processed += result.processed;
			refundEvaluationBudget(batch.length - result.processed, now);
			i += batch.length;
		}
		if (processed === units.length)
			setFollowupMeta("last_run_at", now.toISOString());
		await notifyCompleted(completedTitles);
		const ingested = sourceStats.reduce(
			(total, source) => total + source.created + source.updated,
			0,
		);
		daemonLog("info", "general", "followups_run", {
			ingested,
			enriched: enrichment.processed,
			reconciled,
			candidates: units.length,
			evaluated,
			opened,
			closed,
			pruned,
			backfilled: migration.queued,
		});
		return {
			status: "ok",
			ingested,
			enriched: enrichment.processed,
			reconciled,
			candidates: units.length,
			evaluated,
			opened,
			closed,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		daemonLog("warn", "general", "followups_run_failed", { error: message });
		return {
			status: "error",
			ingested: 0,
			enriched: 0,
			reconciled: 0,
			candidates: 0,
			evaluated: 0,
			opened: 0,
			closed: 0,
			error: message,
		};
	}
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		signal.addEventListener("abort", done, { once: true });
	});
}

export async function runFollowupsScheduler(params: {
	readonly signal: AbortSignal;
}): Promise<void> {
	const { signal } = params;
	await pause(STARTUP_DELAY_MS, signal);
	while (!signal.aborted) {
		const config = readConfig().followups;
		const interval = Number(config?.intervalMinutes);
		const intervalMinutes =
			Number.isFinite(interval) && interval >= 1
				? Math.round(interval)
				: DEFAULT_INTERVAL_MINUTES;
		if (config?.enabled !== false && isWithinActiveHours(new Date())) {
			const result = await runFollowupsOnce();
			if (result.status !== "ok" && result.status !== "disabled")
				daemonLog("warn", "general", "followups_scheduler_status", {
					...result,
				});
		}
		await pause(intervalMinutes * 60_000, signal);
	}
}
