import { z } from "zod";
import {
	currentDateTimePromptSection,
	formatLocalTimestampForPrompt,
} from "../ai/current-datetime";
import type { Persona } from "../config/index";
import { runFlowDefinition } from "../flows/runner";
import type { FlowDefinition, FlowResult } from "../flows/types";
import { composeSystemPromptWithPersona } from "../personas/prompt";
import { FEED_ACTIONS, allowedActionIds, resolveActions } from "./actions";
import {
	EMPTY_PERSONALIZATION,
	type FeedPersonalization,
	formatPersonalizationForPrompt,
} from "./personalization";
import {
	FEED_TIERS,
	type FeedCandidate,
	type FeedItem,
	type FeedModelRef,
	type FeedTier,
} from "./types";

export const FEED_FLOW_NAME = "dashboard.feed";
export const MAX_FEED_ITEMS = 12;
/** Bump when ranking prompt/schema semantics change so cached rankings re-run. */
export const FEED_RANKING_VERSION = "rank-v6";
const RANK_TIMEOUT_MS = 60_000;
const RANK_MAX_OUTPUT_TOKENS = 4000;

/**
 * Model output. Every field is required (strict json_schema providers reject
 * optional properties), and ids are short prompt keys (`c1`, `c2`, …).
 */
export const feedRankingSchema = z.object({
	items: z
		.array(
			z.object({
				key: z.string().describe("Candidate key, e.g. c3"),
				tier: z.enum(["now", "today", "fyi"]),
				priority: z
					.number()
					.describe(
						"Importance from 1 (low) to 100 (critical), comparable across sources",
					),
				reason: z
					.string()
					.describe("One sentence: why this matters to the user now"),
				actions: z
					.array(z.string())
					.describe("Action ids from the candidate's allowed list, best first"),
			}),
		)
		.describe("Most relevant items first"),
});

export type FeedRankingOutput = z.infer<typeof feedRankingSchema>;

/** Ranking input to validation; `priority` is optional so older output still parses. */
export type FeedRankingInput = {
	readonly items: readonly (Omit<
		FeedRankingOutput["items"][number],
		"priority"
	> & { readonly priority?: number })[];
};

/** Prompt key for candidate at index `i`. */
export function candidateKey(i: number): string {
	return `c${i + 1}`;
}

export function buildFeedSystemPrompt(
	persona: Persona,
	now = new Date(),
	personalization: FeedPersonalization = EMPTY_PERSONALIZATION,
): string {
	const actionGlossary = Object.entries(FEED_ACTIONS)
		.filter(([, spec]) => spec.kind !== "open" && spec.kind !== "local")
		.map(([id, spec]) => `- ${id} ("${spec.label}"): ${spec.hint}`)
		.join("\n");
	const personal = formatPersonalizationForPrompt(personalization);
	const base = `You are the user's personal assistant curating "The Feed": a short, prioritized list of the things across their email, calendar, tasks, chat, and news that most deserve their attention right now.

Your job:
1. Choose at most ${MAX_FEED_ITEMS} candidates that genuinely matter. Leave out noise: newsletters, automated notifications, marketing, and anything that needs no attention.
2. Order them most important first, judging every item on its own merits regardless of source. Do not group items by source type (email, calendar, tasks); an overdue task or urgent email can outrank a routine meeting.
3. Give each item a priority from 1 to 100 on one scale shared by all sources (90+: act immediately; 60–89: important today; 30–59: worth doing; below 30: minor).
4. Assign a tier:
   - now: needs attention within the next hour or so (meeting starting soon, urgent reply, overdue and important)
   - today: should be handled today
   - fyi: worth knowing, no rush
5. Write one plain sentence of reason per item explaining why it matters now and what the user should do. Be specific (names, times, deadlines). No markdown.
6. Pick 1–2 actions per item, best first, ONLY from that candidate's "allowed actions" list.

Action meanings:
${actionGlossary}

Rules:
- Only use candidate keys that appear in the list. Never invent items.
- Treat the "signals" as facts computed from the source data.
- Write times in the user's local timezone; never output raw ISO timestamps.
- Calendar: being on the calendar is not enough. Include an event only when it needs something from the user — preparation, materials, a decision, a reply to the invite, a follow-up, or it starts within the hour and they need the heads-up. Leave out holds, focus or blocked time, placeholders, and routine recurring meetings with no agenda unless they are about to start. An event the user only needs to show up to is not Feed material — that includes talks, trainings, webinars, community or social events, and large meetings where they are mostly listening. Prefer events where the agenda or notes ask something of the user specifically. Tomorrow's events belong only when something must be prepared today. At most 3 calendar items unless more start within the hour.
- Chat: direct messages and mentions where someone is waiting on the user rank like email that needs a reply; skip chatter that needs nothing from them.
- News is context, not work: include at most 2 headlines, only when they plausibly matter to this user (their industry, employer, interests, location, or what they know from memory), always in the fyi tier with a low priority. Leave news out entirely when nothing fits.
${personal ? `\n${personal}\n` : ""}
${currentDateTimePromptSection(now)}`;
	return composeSystemPromptWithPersona(base, persona);
}

export function formatCandidatesForPrompt(
	candidates: readonly FeedCandidate[],
): string {
	if (candidates.length === 0) return "(no candidates)";
	return interleaveByCategory(candidates)
		.map(({ c, i }) => {
			const lines = [`${candidateKey(i)} [${c.category}] ${c.title}`];
			if (c.subtitle) lines.push(`   from/list: ${c.subtitle}`);
			if (c.detail) lines.push(`   detail: ${c.detail.slice(0, 280)}`);
			if (c.event?.notes)
				lines.push(
					`   notes: ${c.event.notes.replace(/\s+/g, " ").slice(0, 280)}`,
				);
			if (c.timestamp)
				lines.push(`   when: ${formatLocalTimestampForPrompt(c.timestamp)}`);
			if (c.dueDate) lines.push(`   due: ${c.dueDate}`);
			if (c.urgency) lines.push(`   urgency: ${c.urgency}`);
			if (c.signals.length > 0)
				lines.push(`   signals: ${c.signals.join("; ")}`);
			lines.push(`   allowed actions: ${allowedActionIds(c).join(", ")}`);
			return lines.join("\n");
		})
		.join("\n");
}

/**
 * Prompt order: round-robin across categories (each in its incoming order) so
 * the list doesn't arrive grouped by source and anchor the model's ordering.
 * Keys stay tied to the original index.
 */
function interleaveByCategory(
	candidates: readonly FeedCandidate[],
): { c: FeedCandidate; i: number }[] {
	const queues = new Map<string, { c: FeedCandidate; i: number }[]>();
	candidates.forEach((c, i) => {
		const q = queues.get(c.category) ?? [];
		q.push({ c, i });
		queues.set(c.category, q);
	});
	const out: { c: FeedCandidate; i: number }[] = [];
	const lists = [...queues.values()];
	for (let round = 0; out.length < candidates.length; round++) {
		for (const q of lists) {
			const next = q[round];
			if (next) out.push(next);
		}
	}
	return out;
}

/** Model priority clamped to 1–100; missing or invalid → 0 (sorts last, model order kept). */
function normalizePriority(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(1, Math.round(value)));
}

function isTier(value: string): value is FeedTier {
	return (FEED_TIERS as readonly string[]).includes(value);
}

/**
 * Validate model output against the candidate set: unknown/duplicate keys are
 * dropped, actions are filtered to the catalog, the list is capped, and items
 * are grouped by tier, then ordered by the model's priority within a tier
 * (model order breaks ties).
 */
export function feedItemsFromRanking(
	output: FeedRankingInput,
	candidates: readonly FeedCandidate[],
): FeedItem[] {
	const byKey = new Map(candidates.map((c, i) => [candidateKey(i), c]));
	const used = new Set<string>();
	const items: FeedItem[] = [];
	const priorities: number[] = [];
	for (const entry of output.items) {
		const key = entry.key.trim().toLowerCase();
		const candidate = byKey.get(key);
		if (!candidate || used.has(key) || !isTier(entry.tier)) continue;
		used.add(key);
		const reason = entry.reason.trim();
		items.push({
			id: candidate.id,
			source: {
				category: candidate.category,
				providerName: candidate.providerName,
				...(candidate.providerDisplayName
					? { providerDisplayName: candidate.providerDisplayName }
					: {}),
				itemId: candidate.itemId,
				...(candidate.url ? { url: candidate.url } : {}),
			},
			tier: entry.tier,
			title: candidate.title,
			...(candidate.subtitle ? { subtitle: candidate.subtitle } : {}),
			reason: reason || candidate.signals.join("; "),
			...(candidate.timestamp ? { timestamp: candidate.timestamp } : {}),
			actions: resolveActions(candidate, entry.actions),
		});
		priorities.push(normalizePriority(entry.priority));
		if (items.length >= MAX_FEED_ITEMS) break;
	}
	const tierRank = (t: FeedTier) => FEED_TIERS.indexOf(t);
	const sorted = items
		.map((item, index) => ({ item, index, priority: priorities[index] ?? 0 }))
		.sort(
			(a, b) =>
				tierRank(a.item.tier) - tierRank(b.item.tier) ||
				b.priority - a.priority ||
				a.index - b.index,
		)
		.map(({ item }) => item);
	return capByCategory(sorted);
}

/**
 * Hard per-source limits on the ranked list (the prompt asks for these, but
 * models drift): calendar items beyond the cap are dropped unless they need
 * attention now, and news is capped outright. Keeps the best-ranked ones.
 */
const MAX_RANKED_FOR: Partial<Record<FeedItem["source"]["category"], number>> =
	{ calendar: 3, news: 2 };

function capByCategory(items: readonly FeedItem[]): FeedItem[] {
	const counts = new Map<string, number>();
	return items.filter((item) => {
		const category = item.source.category;
		const max = MAX_RANKED_FOR[category];
		if (max === undefined) return true;
		if (category === "calendar" && item.tier === "now") return true;
		const n = counts.get(category) ?? 0;
		counts.set(category, n + 1);
		return n < max;
	});
}

/** Code-defined flow so runs are recorded in flow history. */
export function feedFlowDefinition(): FlowDefinition {
	return {
		name: FEED_FLOW_NAME,
		description:
			"Rank timely items across email, calendar, and tasks for The Feed.",
		nodes: [
			{
				id: "rank",
				type: "llm_prompter",
				schema: feedRankingSchema,
				schemaName: "FeedRanking",
				schemaDescription:
					"Prioritized Feed items with tier, reason, and allowed actions",
				structuredOutput: "required",
				temperature: 0.2,
				maxOutputTokens: RANK_MAX_OUTPUT_TOKENS,
				timeoutMs: RANK_TIMEOUT_MS,
				systemPrompt: (ctx) =>
					buildFeedSystemPrompt(
						ctx.persona,
						new Date(),
						(ctx.bag.personalization as FeedPersonalization | undefined) ??
							EMPTY_PERSONALIZATION,
					),
				userPrompt: (ctx) =>
					`Candidates:\n\n${formatCandidatesForPrompt(
						(ctx.bag.candidates as FeedCandidate[] | undefined) ?? [],
					)}`,
				outputs: { ranking: "object" },
			},
		],
	};
}

export type FeedRankResult =
	| {
			readonly ok: true;
			readonly items: FeedItem[];
			readonly personaName: string;
	  }
	| {
			readonly ok: false;
			readonly error: string;
			readonly gatewayFunds?: Extract<
				FlowResult,
				{ ok: false }
			>["gatewayFunds"];
	  };

/**
 * Rank candidates with the Feed model. The dashboard persona supplies voice
 * and instructions; its `ai` block is replaced by the Feed model.
 */
export async function rankFeedCandidates(params: {
	readonly candidates: readonly FeedCandidate[];
	readonly persona: Persona;
	readonly model: FeedModelRef;
	readonly personalization?: FeedPersonalization;
	readonly trigger?: string;
	readonly run?: typeof runFlowDefinition;
}): Promise<FeedRankResult> {
	const run = params.run ?? runFlowDefinition;
	const persona: Persona = {
		...params.persona,
		ai: { provider: params.model.provider, model: params.model.model },
	};
	const result = await run(feedFlowDefinition(), {
		personaOverride: persona,
		inputs: {
			candidates: params.candidates,
			personalization: params.personalization ?? EMPTY_PERSONALIZATION,
		},
		trigger: params.trigger ?? FEED_FLOW_NAME,
	});
	if (!result.ok) {
		return {
			ok: false,
			error: result.error ?? "Feed ranking failed",
			...(result.gatewayFunds ? { gatewayFunds: result.gatewayFunds } : {}),
		};
	}
	const parsed = feedRankingSchema.safeParse(result.outputs.ranking);
	if (!parsed.success) {
		return { ok: false, error: "Feed ranking returned an invalid shape" };
	}
	return {
		ok: true,
		items: feedItemsFromRanking(parsed.data, params.candidates),
		personaName: persona.name,
	};
}
