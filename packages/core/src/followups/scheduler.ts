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
	hasNegativeFollowupFeedback,
	listFollowupLoops,
	markUnitEvaluated,
	recordFollowupFeedback,
	refundEvaluationBudget,
	setFollowupEvaluatedHash,
	setFollowupMeta,
	setFollowupTodoId,
	updateFollowupLoop,
} from "./store";
import { followupEvaluationSchema } from "./types";
import type { FollowupLoop, FollowupUnit } from "./types";
import {
	buildFollowupUnitsPage,
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

function normalizedTitle(title: string): string {
	return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Stable identity for a follow-up. A thread has at most one owe-reply and one
 * awaiting-reply loop, so those ignore the model's wording; a commitment is
 * keyed by its title because one thread can carry several. Evidence is left
 * out on purpose: new replies or flag changes must not mint a new identity,
 * or a dismissed follow-up would come back.
 */
function followupFingerprint(
	kind: string,
	unit: FollowupUnit,
	title: string,
): string {
	return sha256(
		kind === "commitment"
			? `${kind}|${unit.unitId}|${normalizedTitle(title)}`
			: `${kind}|${unit.unitId}`,
	);
}

function sameFollowup(
	loop: FollowupLoop,
	kind: FollowupLoop["kind"],
	title: string,
): boolean {
	return (
		loop.kind === kind &&
		(kind !== "commitment" ||
			normalizedTitle(loop.title) === normalizedTitle(title))
	);
}

/** The todo, or null when it was purged or never created. */
function findTodo(todoId: string): ReturnType<typeof getTodo> | null {
	try {
		return getTodo(todoId);
	} catch {
		return null;
	}
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

/** Link new evidence to an open loop and move its activity time forward. */
function mergeEvidence(
	loop: FollowupLoop,
	evidence: readonly string[],
	kind: string,
	confidence: number,
): FollowupLoop {
	const linkedEvidence = new Set(
		edgesTouching([loop.loopId], {
			edgeTypes: ["evidence_for"],
			fanout: 1000,
		})
			.filter((edge) => edge.src === loop.loopId)
			.map((edge) => edge.dst),
	);
	const newEvidence = evidence.filter((id) => !linkedEvidence.has(id));
	if (newEvidence.length === 0) return loop;
	addEvidenceEdges(
		loop.loopId,
		newEvidence,
		`New evidence supporting ${kind.replaceAll("_", " ")}.`,
		confidence,
	);
	const lastActivityAt = evidenceActivityAt(newEvidence, loop.lastActivityAt);
	if (lastActivityAt === loop.lastActivityAt) return loop;
	return updateFollowupLoop(loop.loopId, { lastActivityAt }) ?? loop;
}

/**
 * Every loop sharing one follow-up identity, oldest first. Generation 0 uses
 * the base fingerprint; when a settled loop sees newer evidence, the next
 * generation gets a fresh loop and todo under `base#n`.
 */
function followupGenerations(base: string): {
	readonly loops: FollowupLoop[];
	readonly fingerprints: string[];
	readonly nextFingerprint: string;
} {
	const loops: FollowupLoop[] = [];
	const fingerprints: string[] = [];
	for (let n = 0; ; n++) {
		const fingerprint = n === 0 ? base : sha256(`${base}#${n}`);
		const loop = findFollowupByFingerprint(fingerprint);
		if (!loop) return { loops, fingerprints, nextFingerprint: fingerprint };
		loops.push(loop);
		fingerprints.push(fingerprint);
	}
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
}): { readonly loop: FollowupLoop | null; readonly created: boolean } {
	const evidence = params.evidenceIds.filter(
		(id) => params.unit.nodeIds.includes(id) && getNode(id),
	);
	if (evidence.length === 0) return { loop: null, created: false };
	const active = params.unit.loopIds
		.map((id) => getFollowupLoop(id))
		.find(
			(loop): loop is FollowupLoop =>
				loop?.status === "open" &&
				sameFollowup(loop, params.kind, params.title),
		);
	if (active)
		return {
			loop: mergeEvidence(active, evidence, params.kind, params.confidence),
			created: false,
		};
	const generations = followupGenerations(
		followupFingerprint(params.kind, params.unit, params.title),
	);
	const prior = generations.loops.at(-1);
	// The user dismissed this follow-up (any generation): never bring it back.
	if (
		generations.loops.some((loop) => loop.status === "dismissed") ||
		generations.fingerprints.some(hasNegativeFollowupFeedback)
	)
		return { loop: prior ?? null, created: false };
	if (prior?.status === "open")
		return {
			loop: mergeEvidence(prior, evidence, params.kind, params.confidence),
			created: false,
		};
	if (prior) {
		// Resolved or expired: only evidence newer than that settles a new loop.
		const settledAt = Date.parse(prior.updatedAt);
		const newest = Date.parse(
			evidenceActivityAt(evidence, new Date(0).toISOString()),
		);
		if (Number.isFinite(settledAt) && newest <= settledAt)
			return { loop: prior, created: false };
	}
	const fingerprint = generations.nextFingerprint;
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
	if (!loopId) return { loop: null, created: false };
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
	return {
		loop: updateFollowupLoop(row.loopId, { todoId }) ?? row,
		created: true,
	};
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
			const { loop, created } = openFollowup({ unit, now, ...item });
			if (loop && created) opened++;
		}
		for (const item of evaluation.close) {
			if (
				item.confidence < closeThreshold ||
				!unit.loopIds.includes(item.loopId) ||
				!unit.nodeIds.includes(item.evidenceId)
			)
				continue;
			const loop = getFollowupLoop(item.loopId);
			if (loop?.status !== "open") continue;
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
				// A purged todo is not an error: the loop still resolves.
				const todo = findTodo(loop.todoId);
				if (todo && !todo.deleted && todo.state.status === "open") {
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
			if (getFollowupLoop(loopId)?.status === "open")
				setFollowupEvaluatedHash(loopId, unit.hash);
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
		const todo = findTodo(loop.todoId);
		if (todo && !todo.deleted)
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
	const todo = findTodo(byTodo.todoId);
	if (!todo || todo.deleted || todo.state.status !== "completed") return false;
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

type RunFollowupsParams = {
	readonly now?: Date;
	readonly evaluate?: (units: readonly FollowupUnit[]) => Promise<unknown>;
	readonly extract?: GraphExtract;
	readonly includeIngest?: boolean;
};

let inFlightRun: Promise<FollowupsRunStats> | null = null;

/**
 * Run one follow-up pass. Single-flight: a call made while a run is in
 * progress (the scheduler tick vs. "Check now") joins that run instead of
 * starting a second one that would double-spend budget and race on todos.
 */
export function runFollowupsOnce(
	params: RunFollowupsParams = {},
): Promise<FollowupsRunStats> {
	if (inFlightRun) return inFlightRun;
	const run = runFollowupsPass(params).finally(() => {
		if (inFlightRun === run) inFlightRun = null;
	});
	inFlightRun = run;
	return run;
}

async function runFollowupsPass(
	params: RunFollowupsParams,
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
		const afterId = previous
			? (getFollowupMeta("last_run_after_id") ?? undefined)
			: undefined;
		const page = buildFollowupUnitsPage({
			since,
			...(afterId ? { afterId } : {}),
			now,
		});
		const allUnits = page.units;
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
		if (processed === units.length) {
			// More changed observations than one page: resume after the last one
			// read instead of jumping to now and skipping the rest.
			setFollowupMeta("last_run_at", page.next?.since ?? now.toISOString());
			setFollowupMeta("last_run_after_id", page.next?.afterId ?? "");
		}
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
