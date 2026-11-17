/**
 * The Feed — a ranked, cross-connection list of timely items with
 * explanations and calls to action. See `docs/feed-plan.md`.
 */

import type {
	DashboardBlockContentSource,
	StandardItemActionId,
} from "../dashboard/types";

/** Source categories the Feed can collect from. */
export type FeedCategory = "email" | "calendar" | "tasks" | "todos";

/** Priority bucket, highest first. */
export type FeedTier = "now" | "today" | "fyi";

export const FEED_TIERS: readonly FeedTier[] = ["now", "today", "fyi"];

/** Stable catalog ids for calls to action. */
export type FeedActionId =
	| "email.draftReply"
	| "email.archive"
	| "email.markRead"
	| "calendar.prep"
	| "task.complete"
	| "task.help"
	| "todo.add"
	| "open"
	| "snooze"
	| "dismiss";

/**
 * How an action runs:
 * - `chat`  — client opens a chat seeded with `prompt`
 * - `tool`  — daemon executes a plugin item action / core service
 * - `open`  — client opens `url`
 * - `local` — Feed state change (dismiss/snooze)
 */
export type FeedActionKind = "chat" | "tool" | "open" | "local";

export interface FeedAction {
	readonly id: FeedActionId;
	readonly label: string;
	readonly kind: FeedActionKind;
	/** Seeded chat prompt (`kind: "chat"`). */
	readonly prompt?: string;
	/** Destination (`kind: "open"`). */
	readonly url?: string;
}

/** Normalized pre-ranking item gathered from a connection. */
export interface FeedCandidate {
	/** Stable feed id: `${category}:${providerName}:${itemId}`. */
	readonly id: string;
	readonly category: FeedCategory;
	readonly providerName: string;
	readonly providerDisplayName?: string;
	/** Opaque provider item id — round-trips to the plugin / todos service. */
	readonly itemId: string;
	readonly title: string;
	readonly subtitle?: string;
	readonly detail?: string;
	readonly timestamp?: string;
	/** Calendar due date (`YYYY-MM-DD`) for todos without a precise time. */
	readonly dueDate?: string;
	readonly urgency?: "low" | "normal" | "high";
	readonly url?: string;
	/** Deterministic hints for the ranker (e.g. "starts in 25 min", "overdue"). */
	readonly signals: readonly string[];
	/** Heuristic pre-score; higher = more likely relevant. */
	readonly score: number;
	/** Standard item actions the source provider implements. */
	readonly providerActions?: readonly StandardItemActionId[];
}

export interface FeedItem {
	readonly id: string;
	readonly source: {
		readonly category: FeedCategory;
		readonly providerName: string;
		readonly providerDisplayName?: string;
		readonly itemId: string;
		readonly url?: string;
	};
	readonly tier: FeedTier;
	readonly title: string;
	readonly subtitle?: string;
	/** One-sentence "why this matters now". */
	readonly reason: string;
	readonly timestamp?: string;
	/** Primary first; always ends with `snooze` and `dismiss`. */
	readonly actions: readonly FeedAction[];
}

/**
 * - `ok` — ranked items (possibly empty)
 * - `setupRequired` — no eligible Feed model; see `setupReason`
 * - `noSources` — no connected provider contributed data
 * - `error` — ranking failed; `items` holds the last good feed, if any
 */
export type FeedStatus = "ok" | "setupRequired" | "noSources" | "error";

export interface FeedModelRef {
	readonly provider: string;
	readonly model: string;
}

export interface FeedContent {
	readonly status: FeedStatus;
	readonly items: readonly FeedItem[];
	readonly generatedAt: string;
	readonly personaName?: string;
	readonly model?: FeedModelRef;
	readonly sources: readonly DashboardBlockContentSource[];
	readonly setupReason?: string;
	readonly error?: string;
}
