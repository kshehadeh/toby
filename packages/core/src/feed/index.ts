import fs from "node:fs";
import { GatewayFundsError } from "../ai/gateway-funds";
import { type Persona, getDashboardFeedPath } from "../config/index";
import { resolveDashboardPersona } from "../dashboard/prompts";
import { daemonLog } from "../logging/daemon-log";
import { collectFeedCandidates } from "./collect";
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
} from "./state";
import type { FeedCandidate, FeedContent, FeedModelRef } from "./types";

export type { FeedContent, FeedItem, FeedAction, FeedTier } from "./types";
export { eligibleFeedProviders, resolveFeedModel } from "./model";

/**
 * Re-rank even when the candidate set is unchanged once a ranking is this old,
 * so time-sensitive tiers ("starts in 20 minutes") stay accurate.
 */
export const FEED_RERANK_MAX_AGE_MS = 15 * 60 * 1000;

interface PersistedFeed {
	readonly signature: string;
	readonly rankedAt: string;
	readonly content: FeedContent;
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
	return applyFeedState(content, loadFeedState(now), now);
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
	const feedState = loadFeedState(now);
	const hidden = hiddenIds(feedState, now);
	const candidates = prefilterCandidates(
		collection.candidates.filter((c) => !hidden.has(c.id)),
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
		persist({ signature, rankedAt: new Date().toISOString(), content });
		return content;
	})().finally(() => inFlight.delete(signature));
	inFlight.set(signature, promise);
	return promise;
}
