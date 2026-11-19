import fs from "node:fs";
import { getDashboardFeedStatePath } from "../config/index";
import { daemonLog } from "../logging/daemon-log";
import type { FeedActionId, FeedContent, FeedItem } from "./types";

/**
 * Per-item Feed state, persisted in `~/.toby/dashboard-feed-state.json`:
 * - `dismissed` — hidden until it ages out of the retention window
 * - `snoozed`   — hidden until `until`
 * - `done`      — the user acted on it from the Feed (archived, completed,
 *                 added as a todo); hidden even if the source still lists it
 */
export type FeedItemStateKind = "dismissed" | "snoozed" | "done";

export interface FeedItemState {
	readonly kind: FeedItemStateKind;
	/** ISO time the state was recorded. */
	readonly at: string;
	/** ISO time a snooze ends. */
	readonly until?: string;
	/** Action that marked the item done. */
	readonly action?: FeedActionId;
}

/** One "Not relevant" mark — what the Feed learns from. */
export interface FeedFeedback {
	/** Source key (`feedbackKeyFor`): category, provider, sender / channel / section. */
	readonly key: string;
	readonly category: string;
	readonly title: string;
	readonly subtitle?: string;
	readonly at: string;
}

export interface FeedState {
	readonly items: Readonly<Record<string, FeedItemState>>;
	/** Item id → ISO time a "Now" notification was sent (at most once per item). */
	readonly notified: Readonly<Record<string, string>>;
	/** "Not relevant" marks, oldest first. */
	readonly feedback: readonly FeedFeedback[];
}

/** Keep dismissed / done / notified records this long. */
export const FEED_STATE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Keep "Not relevant" feedback this long, and at most this many marks. */
export const FEED_FEEDBACK_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const FEED_FEEDBACK_MAX = 200;

/** Hour (local) a "Snooze until tomorrow" ends. */
export const FEED_SNOOZE_HOUR = 8;

const EMPTY: FeedState = { items: {}, notified: {}, feedback: [] };

let memory: FeedState | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseState(raw: unknown): FeedState {
	if (!isRecord(raw)) return EMPTY;
	const items: Record<string, FeedItemState> = {};
	if (isRecord(raw.items)) {
		for (const [id, value] of Object.entries(raw.items)) {
			if (!isRecord(value) || typeof value.at !== "string") continue;
			const kind = value.kind;
			if (kind !== "dismissed" && kind !== "snoozed" && kind !== "done")
				continue;
			items[id] = {
				kind,
				at: value.at,
				...(typeof value.until === "string" ? { until: value.until } : {}),
				...(typeof value.action === "string"
					? { action: value.action as FeedActionId }
					: {}),
			};
		}
	}
	const notified: Record<string, string> = {};
	if (isRecord(raw.notified)) {
		for (const [id, at] of Object.entries(raw.notified)) {
			if (typeof at === "string") notified[id] = at;
		}
	}
	const feedback: FeedFeedback[] = [];
	if (Array.isArray(raw.feedback)) {
		for (const entry of raw.feedback) {
			if (
				!isRecord(entry) ||
				typeof entry.key !== "string" ||
				typeof entry.at !== "string" ||
				typeof entry.title !== "string"
			)
				continue;
			feedback.push({
				key: entry.key,
				category: typeof entry.category === "string" ? entry.category : "",
				title: entry.title,
				...(typeof entry.subtitle === "string"
					? { subtitle: entry.subtitle }
					: {}),
				at: entry.at,
			});
		}
	}
	return { items, notified, feedback };
}

/** Drop expired snoozes and records older than the retention window. */
export function pruneFeedState(state: FeedState, now: Date): FeedState {
	const cutoff = now.getTime() - FEED_STATE_RETENTION_MS;
	const items: Record<string, FeedItemState> = {};
	for (const [id, entry] of Object.entries(state.items)) {
		if (entry.kind === "snoozed") {
			const until = Date.parse(entry.until ?? "");
			if (Number.isNaN(until) || until <= now.getTime()) continue;
		} else if (Date.parse(entry.at) < cutoff) {
			continue;
		}
		items[id] = entry;
	}
	const notified: Record<string, string> = {};
	for (const [id, at] of Object.entries(state.notified)) {
		if (Date.parse(at) >= cutoff) notified[id] = at;
	}
	const feedbackCutoff = now.getTime() - FEED_FEEDBACK_RETENTION_MS;
	const feedback = state.feedback
		.filter((f) => Date.parse(f.at) >= feedbackCutoff)
		.slice(-FEED_FEEDBACK_MAX);
	return { items, notified, feedback };
}

export function loadFeedState(now: Date = new Date()): FeedState {
	if (!memory) {
		try {
			const file = getDashboardFeedStatePath();
			memory = fs.existsSync(file)
				? parseState(JSON.parse(fs.readFileSync(file, "utf-8")))
				: EMPTY;
		} catch {
			memory = EMPTY;
		}
	}
	return pruneFeedState(memory, now);
}

export function saveFeedState(state: FeedState): void {
	memory = state;
	try {
		fs.writeFileSync(
			getDashboardFeedStatePath(),
			JSON.stringify(state, null, 2),
			"utf-8",
		);
	} catch (error) {
		daemonLog("warn", "general", "feed_state_persist_error", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/** Apply `update` to the current (pruned) state and persist it. */
export function updateFeedState(
	update: (state: FeedState) => FeedState,
	now: Date = new Date(),
): FeedState {
	const next = update(loadFeedState(now));
	saveFeedState(next);
	return next;
}

/** Clear in-memory state (tests). */
export function clearFeedStateCache(): void {
	memory = null;
}

export function setItemState(
	state: FeedState,
	id: string,
	entry: FeedItemState,
): FeedState {
	return { ...state, items: { ...state.items, [id]: entry } };
}

export function markNotified(
	state: FeedState,
	ids: readonly string[],
	at: string,
): FeedState {
	const notified = { ...state.notified };
	for (const id of ids) notified[id] = at;
	return { ...state, notified };
}

export function addFeedback(state: FeedState, entry: FeedFeedback): FeedState {
	return {
		...state,
		feedback: [...state.feedback, entry].slice(-FEED_FEEDBACK_MAX),
	};
}

/** "Not relevant" marks per source key. */
export function feedbackCounts(state: FeedState): Map<string, number> {
	const counts = new Map<string, number>();
	for (const f of state.feedback)
		counts.set(f.key, (counts.get(f.key) ?? 0) + 1);
	return counts;
}

/** True when the item is dismissed, done, or snoozed past `now`. */
export function isHidden(state: FeedState, id: string, now: Date): boolean {
	const entry = state.items[id];
	if (!entry) return false;
	if (entry.kind !== "snoozed") return true;
	const until = Date.parse(entry.until ?? "");
	return !Number.isNaN(until) && until > now.getTime();
}

/** Ids currently hidden by Feed state. */
export function hiddenIds(state: FeedState, now: Date): Set<string> {
	return new Set(
		Object.keys(state.items).filter((id) => isHidden(state, id, now)),
	);
}

/** Remove hidden items from a Feed payload. */
export function applyFeedState(
	content: FeedContent,
	state: FeedState,
	now: Date,
): FeedContent {
	const visible = content.items.filter(
		(item: FeedItem) => !isHidden(state, item.id, now),
	);
	return visible.length === content.items.length
		? content
		: { ...content, items: visible };
}

/** Next local `FEED_SNOOZE_HOUR`:00 strictly after `now` (tomorrow morning). */
export function snoozeUntilTomorrow(now: Date): Date {
	const until = new Date(now);
	until.setDate(until.getDate() + 1);
	until.setHours(FEED_SNOOZE_HOUR, 0, 0, 0);
	return until;
}
