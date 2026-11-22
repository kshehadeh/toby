import fs from "node:fs";
import { GatewayFundsError } from "../ai/gateway-funds";
import { type Persona, getDashboardFeedPath } from "../config/index";
import { resolveDashboardPersona } from "../dashboard/prompts";
import { daemonLog } from "../logging/daemon-log";
import { collectFeedCandidates } from "./collect";
import {
	type CompileInstruction,
	type FeedRuleFilter,
	activeRuleFilters,
	applyRuleFilters,
	compileInstructionRule,
	instructionRuleHash,
	instructionsNeedingCompile,
	modelRuleCompiler,
	ruleContextFrom,
} from "./instruction-filters";
import { type FeedModelResolution, resolveFeedModel } from "./model";
import {
	type FeedPersonalization,
	buildFeedPersonalization,
	personalizationSignature,
} from "./personalization";
import { candidateSignature, prefilterCandidates } from "./prefilter";
import { FEED_RANKING_VERSION, rankFeedCandidates } from "./rank";
import {
	type FeedState,
	applyFeedState,
	feedbackCounts,
	hiddenIds,
	loadFeedState,
	setInstructionRule,
	updateFeedState,
} from "./state";
import type {
	FeedCandidate,
	FeedContent,
	FeedItem,
	FeedModelRef,
} from "./types";

export type { FeedContent, FeedItem, FeedAction, FeedTier } from "./types";
export { eligibleFeedProviders, resolveFeedModel } from "./model";

/**
 * Re-rank even when the candidate set is unchanged once a ranking is this old,
 * so time-sensitive tiers ("starts in 20 minutes") stay accurate.
 */
export const FEED_RERANK_MAX_AGE_MS = 15 * 60 * 1000;

/** How long items dropped by a re-rank stay actionable. */
export const FEED_RECENT_ITEM_TTL_MS = 24 * 60 * 60 * 1000;
const FEED_RECENT_ITEMS_MAX = 100;

interface RecentFeedItem {
	readonly item: FeedItem;
	/** When the item was last in a ranked Feed. */
	readonly seenAt: string;
}

interface PersistedFeed {
	readonly signature: string;
	readonly rankedAt: string;
	readonly content: FeedContent;
	/**
	 * Items from earlier rankings that the current one dropped. The app may
	 * still be showing them (a background re-rank lands between its loads),
	 * so actions on them keep working.
	 */
	readonly recentItems?: readonly RecentFeedItem[];
}

let memory: PersistedFeed | null = null;
const inFlight = new Map<string, Promise<FeedContent>>();

function loadPersisted(): PersistedFeed | null {
	if (memory) return memory;
	try {
		const file = getDashboardFeedPath();
		if (!fs.existsSync(file)) return null;
		const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as PersistedFeed;
		if (!parsed?.signature || !parsed.content) return null;
		memory = parsed;
		return parsed;
	} catch {
		return null;
	}
}

function persist(entry: PersistedFeed): void {
	memory = entry;
	try {
		fs.writeFileSync(
			getDashboardFeedPath(),
			JSON.stringify(entry, null, 2),
			"utf-8",
		);
	} catch (error) {
		daemonLog("warn", "general", "feed_persist_error", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/** Clear in-memory Feed state (tests / config changes). */
export function clearFeedCache(): void {
	memory = null;
	inFlight.clear();
}

/** Last ranked Feed (unfiltered), if any. */
export function getPersistedFeed(): FeedContent | null {
	return loadPersisted()?.content ?? null;
}

/**
 * An item from the current Feed or one a recent re-rank dropped (the app can
 * still be showing it). Used to resolve Feed actions.
 */
export function findFeedItem(id: string): FeedItem | undefined {
	const entry = loadPersisted();
	if (!entry) return undefined;
	return (
		entry.content.items.find((i) => i.id === id) ??
		entry.recentItems?.find((r) => r.item.id === id)?.item
	);
}

/**
 * Carry the previous ranking's items (and still-young recent items) forward,
 * minus anything in the new ranking, newest first and bounded.
 */
export function nextRecentItems(
	previous: PersistedFeed | null,
	next: FeedContent,
	now: Date,
): RecentFeedItem[] {
	if (!previous) return [];
	const current = new Set(next.items.map((i) => i.id));
	const seen = new Set<string>();
	const out: RecentFeedItem[] = [];
	const candidates: RecentFeedItem[] = [
		...previous.content.items.map((item) => ({
			item,
			seenAt: previous.rankedAt,
		})),
		...(previous.recentItems ?? []),
	];
	for (const r of candidates) {
		if (current.has(r.item.id) || seen.has(r.item.id)) continue;
		const t = Date.parse(r.seenAt);
		if (Number.isNaN(t) || now.getTime() - t > FEED_RECENT_ITEM_TTL_MS)
			continue;
		seen.add(r.item.id);
		out.push(r);
		if (out.length >= FEED_RECENT_ITEMS_MAX) break;
	}
	return out;
}

function isFresh(entry: PersistedFeed, now: number): boolean {
	const t = Date.parse(entry.rankedAt);
	return !Number.isNaN(t) && now - t < FEED_RERANK_MAX_AGE_MS;
}

export interface GetFeedOptions {
	/** Bypass caches and re-collect + re-rank. */
	readonly force?: boolean;
	/**
	 * Re-collect from sources (bypassing their short cache) and, when the
	 * ranking is stale, re-rank inline instead of in the background. Skips the
	 * LLM call when the candidate set is unchanged and the ranking is recent.
	 * Used by the background scheduler.
	 */
	readonly awaitRerank?: boolean;
	/** Caller label recorded on the flow run. */
	readonly trigger?: string;
	/** Test seam for model resolution. */
	readonly resolveModel?: () => Promise<FeedModelResolution>;
	/** Test seam for memories + feedback given to the ranker. */
	readonly personalize?: (state: FeedState) => FeedPersonalization;
	/** Test seam for compiling instructions into filters. */
	readonly compileRule?: CompileInstruction;
}

const compiling = new Map<string, Promise<void>>();

/**
 * Compile enabled instructions that have no current rule, store the result,
 * and return the filters in force. A compile failure leaves that instruction
 * as prompt guidance until it is retried.
 */
export async function ensureFeedRuleFilters(params: {
	readonly candidates: Parameters<typeof ruleContextFrom>[0];
	readonly persona: Persona;
	readonly model: FeedModelRef;
	readonly now: Date;
	readonly compile?: CompileInstruction;
}): Promise<FeedRuleFilter[]> {
	const pending = instructionsNeedingCompile(
		loadFeedState(params.now).instructions,
		params.now,
	);
	if (pending.length > 0) {
		const compile =
			params.compile ??
			modelRuleCompiler({ persona: params.persona, model: params.model });
		const context = ruleContextFrom(params.candidates);
		await Promise.all(
			pending.map((instruction) => {
				const key = `${instruction.id}:${instructionRuleHash(instruction.text)}`;
				const existing = compiling.get(key);
				if (existing) return existing;
				const job = compileInstructionRule(
					instruction,
					context,
					compile,
					params.now,
				)
					.then((rule) => {
						if (rule.status === "failed")
							daemonLog("warn", "general", "feed_rule_compile_failed", {
								error: rule.error,
							});
						updateFeedState((s) =>
							setInstructionRule(s, instruction.id, rule, instructionRuleHash),
						);
					})
					.finally(() => compiling.delete(key));
				compiling.set(key, job);
				return job;
			}),
		);
	}
	return activeRuleFilters(loadFeedState(params.now).instructions);
}

/**
 * Compile any new or edited instructions now (after one is added or turned
 * on), so the instructions sheet can show how each is enforced. Never throws.
 */
export async function compileFeedInstructionRules(): Promise<void> {
	try {
		const resolution = await resolveFeedModel();
		if (!resolution.ok) return;
		const now = new Date();
		const collection = await collectFeedCandidates({ force: false, now });
		await ensureFeedRuleFilters({
			candidates: collection.candidates,
			persona: resolveDashboardPersona(),
			model: resolution.ref,
			now,
		});
	} catch (error) {
		daemonLog("warn", "general", "feed_rule_compile_failed", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/** Drop items the user's compiled instructions hide (e.g. from a cached ranking). */
function applyRuleFiltersToContent(
	content: FeedContent,
	filters: readonly FeedRuleFilter[],
): FeedContent {
	if (filters.length === 0) return content;
	const kept = applyRuleFilters(
		content.items.map((item) => ({
			item,
			category: item.source.category,
			providerName: item.source.providerName,
			providerDisplayName: item.source.providerDisplayName,
			subtitle: item.subtitle,
		})),
		filters,
	);
	return kept.length === content.items.length
		? content
		: { ...content, items: kept.map((k) => k.item) };
}

/**
 * Build The Feed: collect → pre-filter → rank (cached by candidate signature).
 *
 * - No eligible model → `setupRequired` (never falls back to an unsupported model).
 * - Unchanged candidates and a recent ranking → cached content, no LLM call.
 * - Changed candidates, not forced, with a prior feed → returns the prior feed
 *   immediately and re-ranks in the background.
 * - Gateway out of funds → throws {@link GatewayFundsError} (HTTP 402).
 *
 * Items dismissed, snoozed, or acted on (Feed state) are excluded from
 * ranking and filtered out of the returned content.
 */
export async function getFeedContent(
	options: GetFeedOptions = {},
): Promise<FeedContent> {
	const now = new Date();
	const content = await buildFeedContent(options, now);
	// A cached or background-pending ranking may predate a new instruction.
	const filtered = applyRuleFiltersToContent(
		content,
		activeRuleFilters(loadFeedState(now).instructions),
	);
	return applyFeedState(filtered, loadFeedState(now), now);
}

async function buildFeedContent(
	options: GetFeedOptions,
	now: Date,
): Promise<FeedContent> {
	const force = options.force === true;
	const awaitRerank = options.awaitRerank === true;
	const persona = resolveDashboardPersona();
	const previous = loadPersisted();

	const resolution = await (options.resolveModel ?? resolveFeedModel)();
	if (!resolution.ok) {
		return {
			status: "setupRequired",
			items: [],
			generatedAt: now.toISOString(),
			personaName: persona.name,
			sources: [],
			setupReason: resolution.reason,
		};
	}
	const model = resolution.ref;

	const collection = await collectFeedCandidates({
		force: force || awaitRerank,
		now,
	});
	// Instructions that leave things out are enforced here, in code; the
	// ranker still sees every instruction as guidance.
	const ruleFilters = await ensureFeedRuleFilters({
		candidates: collection.candidates,
		persona,
		model,
		now,
		...(options.compileRule ? { compile: options.compileRule } : {}),
	});
	const feedState = loadFeedState(now);
	const hidden = hiddenIds(feedState, now);
	const candidates = prefilterCandidates(
		applyRuleFilters(
			collection.candidates.filter((c) => !hidden.has(c.id)),
			ruleFilters,
		),
		now,
		feedbackCounts(feedState),
	);
	const personalization = (options.personalize ?? buildFeedPersonalization)(
		feedState,
	);
	const base = {
		generatedAt: now.toISOString(),
		personaName: persona.name,
		model,
		sources: collection.sources,
	};

	if (collection.sources.length === 0) {
		return { ...base, status: "noSources", items: [] };
	}
	if (candidates.length === 0) {
		return { ...base, status: "ok", items: [] };
	}

	const signature = candidateSignature(candidates, [
		FEED_RANKING_VERSION,
		model.provider,
		model.model,
		persona.name,
		personalizationSignature(personalization),
	]);

	if (!force && previous) {
		if (previous.signature === signature && isFresh(previous, now.getTime())) {
			return previous.content;
		}
		if (previous.content.status === "ok" && !awaitRerank) {
			void rerank(
				signature,
				candidates,
				persona,
				model,
				base,
				options,
				personalization,
			).catch(() => {});
			return previous.content;
		}
	}

	return rerank(
		signature,
		candidates,
		persona,
		model,
		base,
		options,
		personalization,
	);
}

function rerank(
	signature: string,
	candidates: readonly FeedCandidate[],
	persona: Persona,
	model: FeedModelRef,
	base: Omit<FeedContent, "status" | "items">,
	options: GetFeedOptions,
	personalization: FeedPersonalization,
): Promise<FeedContent> {
	const existing = inFlight.get(signature);
	if (existing) return existing;
	const promise = (async (): Promise<FeedContent> => {
		const result = await rankFeedCandidates({
			candidates,
			persona,
			model,
			personalization,
			...(options.trigger ? { trigger: options.trigger } : {}),
		});
		if (!result.ok) {
			if (result.gatewayFunds) {
				throw new GatewayFundsError(
					result.gatewayFunds.providerId,
					"update The Feed",
				);
			}
			daemonLog("warn", "general", "feed_rank_error", {
				error: result.error,
				provider: model.provider,
				model: model.model,
			});
			const last = loadPersisted();
			return {
				...base,
				status: "error",
				items: last?.content.items ?? [],
				error: result.error,
			};
		}
		const content: FeedContent = {
			...base,
			status: "ok",
			items: result.items,
			personaName: result.personaName,
		};
		const rankedAt = new Date();
		persist({
			signature,
			rankedAt: rankedAt.toISOString(),
			content,
			recentItems: nextRecentItems(loadPersisted(), content, rankedAt),
		});
		return content;
	})().finally(() => inFlight.delete(signature));
	inFlight.set(signature, promise);
	return promise;
}
