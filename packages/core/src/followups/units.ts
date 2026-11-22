import { createHash } from "node:crypto";
import { readConfig } from "../config/index";
import { contextFor, isNodeVisible, neighbors } from "../graph/query";
import { edgesTouching, getNode } from "../graph/store";
import {
	allSelfIdentities,
	listIngestedSince,
	listObservationsOccurredSince,
	listThreadObservations,
} from "../observations/store";
import type { Observation } from "../observations/types";
import { listFollowupInstructions, listFollowupLoops } from "./store";
import type { FollowupLoop, FollowupUnit } from "./types";

const MAX_THREAD_MESSAGES = 20;
const MAX_UNIT_TEXT_CHARS = 10_000;
/** Changed observations read per run; the rest are picked up next run. */
export const MAX_CHANGED_OBSERVATIONS = 2000;

function hash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function groupKey(observation: Observation): string {
	return observation.threadKey
		? `${observation.sourceId}:${observation.threadKey}`
		: `${observation.sourceId}:${observation.externalId}`;
}

function canOpenFrom(observations: readonly Observation[]): boolean {
	return (
		observations.some(
			(observation) =>
				observation.sourceId.startsWith("plugin:") ||
				observation.sourceId === "calendar",
		) &&
		!observations.every(
			(observation) =>
				observation.facts.bulk === true ||
				observation.facts.noReply === true ||
				observation.facts.autoSubmitted === true,
		)
	);
}

function observationText(observations: readonly Observation[]): string {
	const lines = observations.slice(-MAX_THREAD_MESSAGES).map((observation) => {
		const excerpt =
			observation.excerpt?.replace(/\s+/g, " ").slice(0, 1800) ?? "";
		return `[evidenceId=${observation.nodeId}] ${observation.occurredAt} ${observation.direction ?? ""} ${observation.kind}: ${observation.title}${excerpt ? `\n${excerpt}` : ""}`;
	});
	return lines.join("\n\n").slice(0, MAX_UNIT_TEXT_CHARS);
}

function unitFor(params: {
	unitId: string;
	observations: readonly Observation[];
	loops: readonly FollowupLoop[];
	now: Date;
}): FollowupUnit {
	const nodeIds = [...new Set(params.observations.map((item) => item.nodeId))];
	const loopIds = params.loops.map((loop) => loop.loopId);
	const followups = readConfig().followups;
	const enabledSources = followups?.sources ?? {};
	const context = contextFor([...nodeIds, ...loopIds], {
		depth: 2,
		limit: 80,
		maxChars: 4500,
		nodeFilter: (node) => {
			if (node.type === "observation") {
				const sourceId = node.props.sourceId;
				return (
					typeof sourceId !== "string" || enabledSources[sourceId] !== false
				);
			}
			if (node.type === "memory") return enabledSources.memory !== false;
			if (node.type === "event") return enabledSources.calendar !== false;
			if (node.type === "todo") return enabledSources["toby.todos"] !== false;
			return true;
		},
	});
	const instructions = listFollowupInstructions().map((item) => item.text);
	const decisionSettings = {
		awaitingReplyDays: followupWaitDays(),
		sources: followups?.sources ?? {},
		kinds: followups?.kinds ?? {},
		thresholds: {
			open: followups?.thresholds?.open ?? 0.75,
			close: followups?.thresholds?.close ?? 0.85,
		},
		autoComplete: followups?.autoComplete !== false,
		evaluator: followups?.evaluator ?? null,
	};
	const identities = allSelfIdentities();
	const latestEmail = [...params.observations]
		.filter((item) => item.kind === "email.message")
		.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
	const waitingReplyEligible = Boolean(
		latestEmail?.direction === "outbound" &&
			params.now.getTime() - Date.parse(latestEmail.occurredAt) >=
				followupWaitDays() * 86_400_000,
	);
	const loopText = params.loops
		.map(
			(loop) =>
				`Open loop ${loop.loopId} (${loop.kind}): ${loop.title}${loop.counterpart ? `; counterpart ${loop.counterpart}` : ""}${loop.resolutionRejected ? `; reopened by the user at ${loop.reopenedAt ?? loop.lastActivityAt}, require new evidence ingested after that time` : ""}`,
		)
		.join("\n");
	const promptContext = [
		`Evaluation time: ${params.now.toISOString()}`,
		`Awaiting-reply wait window elapsed: ${waitingReplyEligible}`,
		`User identities: ${JSON.stringify(identities)}`,
		instructions.length
			? `Follow-up instructions:\n${instructions.join("\n")}`
			: "",
		`Follow-up settings: ${JSON.stringify(decisionSettings)}`,
		loopText,
		context.text ? `Graph context:\n${context.text}` : "",
	]
		.filter(Boolean)
		.join("\n\n")
		.slice(0, 6000);
	const sourceText = observationText(params.observations);
	const evidenceHash = hash(
		params.observations.map((o) => [o.nodeId, o.contentHash]),
	);
	const contentHash = hash({
		observations: params.observations.map((o) => [o.nodeId, o.contentHash]),
		// Only fields the evaluator sees: bookkeeping writes (updated_at,
		// lastEvaluatedHash, edge upserts) must not force a re-evaluation.
		loops: params.loops.map((loop) => [
			loop.loopId,
			loop.status,
			loop.kind,
			loop.title,
			loop.counterpart ?? null,
			loop.resolutionRejected,
			loop.reopenedAt ?? null,
		]),
		context: context.nodes.map((item) => [
			item.node.id,
			item.node.label,
			item.node.props,
		]),
		instructions,
		decisionSettings,
		waitingReplyEligible,
	});
	return {
		unitId: params.unitId,
		hash: contentHash,
		evidenceHash,
		nodeIds,
		loopIds,
		waitingReplyEligible,
		promptContext,
		sourceText,
		evaluatedAt: params.now.toISOString(),
	};
}

/** Assemble changed source threads and nearby open loops without mutating state. */
export function buildFollowupUnits(params: {
	readonly since: string;
	readonly afterId?: string;
	readonly now?: Date;
}): FollowupUnit[] {
	return buildFollowupUnitsPage(params).units;
}

/** Where the next run resumes when more changed observations remain. */
export interface FollowupUnitsCursor {
	readonly since: string;
	readonly afterId: string;
}

/**
 * Like {@link buildFollowupUnits}, but reads at most
 * {@link MAX_CHANGED_OBSERVATIONS} changed observations and returns `next`
 * when it stopped early.
 */
export function buildFollowupUnitsPage(params: {
	readonly since: string;
	readonly afterId?: string;
	readonly now?: Date;
}): { readonly units: FollowupUnit[]; readonly next?: FollowupUnitsCursor } {
	const now = params.now ?? new Date();
	const changedPage = listIngestedSince(
		params.since,
		MAX_CHANGED_OBSERVATIONS,
		params.afterId,
	);
	const last = changedPage.at(-1);
	const next =
		last && changedPage.length >= MAX_CHANGED_OBSERVATIONS
			? { since: last.ingestedAt, afterId: last.id }
			: undefined;
	const observations = changedPage.filter((observation) => {
		const node = getNode(observation.nodeId);
		return node && isNodeVisible(node, { now });
	});
	const changedGroups = new Map<string, Observation[]>();
	const enabledSources = readConfig().followups?.sources ?? {};
	const enabledObservations = observations.filter(
		(observation) => enabledSources[observation.sourceId] !== false,
	);
	for (const observation of enabledObservations) {
		const key = groupKey(observation);
		const existing = changedGroups.get(key) ?? [];
		existing.push(observation);
		changedGroups.set(key, existing);
	}
	const retentionStart = new Date(
		now.getTime() - 45 * 86_400_000,
	).toISOString();
	const recent = listObservationsOccurredSince(retentionStart, 5000);
	const openGroups = new Map<string, Observation[]>();
	for (const [key, changed] of changedGroups) {
		if (!canOpenFrom(changed)) continue;
		const first = changed[0];
		const thread = first?.threadKey
			? listThreadObservations(first.threadKey, MAX_THREAD_MESSAGES)
			: changed;
		openGroups.set(key, thread);
	}
	const recentThreads = new Map<string, Observation[]>();
	for (const observation of recent) {
		if (
			enabledSources[observation.sourceId] === false ||
			observation.sourceId !== "plugin:email" ||
			observation.kind !== "email.message" ||
			!observation.threadKey
		)
			continue;
		const key = groupKey(observation);
		const items = recentThreads.get(key) ?? [];
		items.push(observation);
		recentThreads.set(key, items);
	}
	for (const [key, messages] of recentThreads) {
		const ordered = [...messages].sort((a, b) =>
			a.occurredAt.localeCompare(b.occurredAt),
		);
		const latest = ordered.at(-1);
		if (latest?.direction !== "outbound" || !canOpenFrom(ordered)) continue;
		if (
			now.getTime() - Date.parse(latest.occurredAt) <
			followupWaitDays() * 86_400_000
		)
			continue;
		const first = ordered[0];
		const thread = first?.threadKey
			? listThreadObservations(first.threadKey, MAX_THREAD_MESSAGES)
			: ordered;
		if (!openGroups.has(key)) openGroups.set(key, thread);
	}
	const openLoops = listFollowupLoops({ status: "open", limit: 1000 });
	const loopById = new Map(openLoops.map((loop) => [loop.loopId, loop]));
	const units = new Map<string, FollowupUnit>();
	const closeByObservation = new Map<string, FollowupLoop[]>();
	for (const observation of enabledObservations) {
		const reached = neighbors(observation.nodeId, {
			depth: 2,
			nodeTypes: ["loop"],
			limit: 100,
		});
		for (const hit of reached) {
			const loop = loopById.get(hit.node.id);
			if (!loop) continue;
			const list = closeByObservation.get(observation.nodeId) ?? [];
			list.push(loop);
			closeByObservation.set(observation.nodeId, list);
		}
	}

	for (const [key, allThread] of openGroups) {
		const changed = changedGroups.get(key) ?? [];
		// Every open loop already citing this thread, so the evaluator updates
		// or closes it instead of opening a duplicate.
		const threadLoops = edgesTouching(
			allThread.map((item) => item.nodeId),
			{ edgeTypes: ["evidence_for"], fanout: 100 },
		)
			.map((edge) => loopById.get(edge.src))
			.filter((loop): loop is FollowupLoop => Boolean(loop));
		const loops = [
			...new Map(
				[
					...threadLoops,
					...changed.flatMap(
						(item) => closeByObservation.get(item.nodeId) ?? [],
					),
				].map((loop) => [loop.loopId, loop]),
			).values(),
		].sort((a, b) => a.loopId.localeCompare(b.loopId));
		units.set(
			`open:${key}`,
			unitFor({
				unitId: `open:${key}`,
				observations: allThread,
				loops,
				now,
			}),
		);
	}
	for (const observation of observations) {
		const loops = closeByObservation.get(observation.nodeId) ?? [];
		if (loops.length === 0) continue;
		const unique = [
			...new Map(loops.map((loop) => [loop.loopId, loop])).values(),
		];
		const id = `close:${observation.nodeId}`;
		units.set(
			id,
			unitFor({ unitId: id, observations: [observation], loops: unique, now }),
		);
	}
	return { units: [...units.values()], ...(next ? { next } : {}) };
}

export function changedFollowupUnits(
	units: readonly FollowupUnit[],
	lastHash: (id: string) => string | null,
): FollowupUnit[] {
	return units.filter((unit) => lastHash(unit.unitId) !== unit.hash);
}

export function followupWaitDays(): number {
	const days = readConfig().followups?.awaitingReplyDays;
	return Number.isFinite(days) ? Math.max(0, Math.min(30, days ?? 3)) : 3;
}
