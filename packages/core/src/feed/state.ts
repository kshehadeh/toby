import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { getDashboardFeedStatePath } from "../config/index";
import { daemonLog } from "../logging/daemon-log";
import {
	type FeedRuleFilter,
	feedRuleCompileSchema,
} from "./instruction-filters";
import type { FeedActionId, FeedContent, FeedItem } from "./types";

/**
 * Per-item Feed state, persisted in `~/.toby/dashboard-feed-state.json`:
 * - `dismissed` — hidden until it ages out of the retention window
 * - `snoozed`   — hidden until `until`
 * - `done`      — the user acted on it from the Feed (archived, completed,
 *                 added as a todo); hidden even if the source still lists it
 *
 * The same file holds "Not relevant" feedback and the user's Feed
 * instructions (never pruned).
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
	/** Source key (`feedbackKeyFor`): category, provider, sender / channel / section / normalized title. */
	readonly key: string;
	readonly category: string;
	readonly title: string;
	readonly subtitle?: string;
	readonly at: string;
}

/** A user-written rule for what The Feed includes and how it ranks. */
export interface FeedInstruction {
	readonly id: string;
	readonly text: string;
	/** ISO time it was added. */
	readonly createdAt: string;
	/** Disabled instructions are kept for reference but not sent to the ranker. */
	readonly enabled: boolean;
	/**
	 * How the instruction is enforced, compiled from its text (`hash`). A
	 * `filter` rule hides matching candidates in code before ranking; every
	 * instruction is also sent to the ranker as guidance.
	 */
	readonly rule?: FeedInstructionRule;
}

export type FeedInstructionRule =
	| {
			readonly status: "filter";
			readonly hash: string;
			readonly at: string;
			readonly filters: readonly FeedRuleFilter[];
			/** Plain description of what gets hidden, for the UI. */
			readonly summary: string;
	  }
	/** Nothing to filter (ordering/emphasis): prompt guidance only. */
	| { readonly status: "guidance"; readonly hash: string; readonly at: string }
	/** Compile failed; retried later. */
	| {
			readonly status: "failed";
			readonly hash: string;
			readonly at: string;
			readonly error: string;
	  };

function parseRule(raw: unknown): FeedInstructionRule | undefined {
	if (!isRecord(raw)) return undefined;
	if (typeof raw.hash !== "string" || typeof raw.at !== "string")
		return undefined;
	const { hash, at } = raw;
	if (raw.status === "guidance") return { status: "guidance", hash, at };
	if (raw.status === "failed")
		return {
			status: "failed",
			hash,
			at,
			error: typeof raw.error === "string" ? raw.error : "",
		};
	if (raw.status === "filter") {
		const parsed = feedRuleCompileSchema.shape.filters.safeParse(raw.filters);
		if (!parsed.success || parsed.data.length === 0) return undefined;
		return {
			status: "filter",
			hash,
			at,
			filters: parsed.data,
			summary: typeof raw.summary === "string" ? raw.summary : "",
		};
	}
	return undefined;
}

export interface FeedState {
	readonly items: Readonly<Record<string, FeedItemState>>;
	/** Item id → ISO time a "Now" notification was sent (at most once per item). */
	readonly notified: Readonly<Record<string, string>>;
	/** "Not relevant" marks, oldest first. */
	readonly feedback: readonly FeedFeedback[];
	/** User instructions, oldest first. */
	readonly instructions: readonly FeedInstruction[];
}

/** Keep dismissed / done / notified records this long. */
export const FEED_STATE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Keep "Not relevant" feedback this long, and at most this many marks. */
export const FEED_FEEDBACK_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const FEED_FEEDBACK_MAX = 200;

/** Instruction limits. */
export const FEED_INSTRUCTIONS_MAX = 50;
export const FEED_INSTRUCTION_MAX_CHARS = 500;

/** Hour (local) a "Snooze until tomorrow" ends. */
export const FEED_SNOOZE_HOUR = 8;

const EMPTY: FeedState = {
	items: {},
	notified: {},
	feedback: [],
	instructions: [],
};

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
	const instructions: FeedInstruction[] = [];
	if (Array.isArray(raw.instructions)) {
		for (const entry of raw.instructions) {
			if (
				!isRecord(entry) ||
				typeof entry.id !== "string" ||
				typeof entry.text !== "string" ||
				typeof entry.createdAt !== "string" ||
				!entry.text.trim()
			)
				continue;
			const rule = parseRule(entry.rule);
			instructions.push({
				id: entry.id,
				text: entry.text,
				createdAt: entry.createdAt,
				enabled: entry.enabled !== false,
				...(rule ? { rule } : {}),
			});
		}
	}
	return { items, notified, feedback, instructions };
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
	return { items, notified, feedback, instructions: state.instructions };
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

/** Trimmed, length-checked instruction text, or an error message. */
export function normalizeInstructionText(
	raw: unknown,
): { ok: true; text: string } | { ok: false; error: string } {
	const text = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
	if (!text) return { ok: false, error: "Instruction text is required." };
	if (text.length > FEED_INSTRUCTION_MAX_CHARS)
		return {
			ok: false,
			error: `Keep instructions under ${FEED_INSTRUCTION_MAX_CHARS} characters.`,
		};
	return { ok: true, text };
}

/** Append an instruction (enabled). Oldest are dropped past the cap. */
export function addInstruction(
	state: FeedState,
	text: string,
	now: Date,
	id: string = randomUUID(),
): FeedState {
	const entry: FeedInstruction = {
		id,
		text,
		createdAt: now.toISOString(),
		enabled: true,
	};
	return {
		...state,
		instructions: [...state.instructions, entry].slice(-FEED_INSTRUCTIONS_MAX),
	};
}

export function setInstructionEnabled(
	state: FeedState,
	id: string,
	enabled: boolean,
): FeedState {
	return {
		...state,
		instructions: state.instructions.map((i) =>
			i.id === id ? { ...i, enabled } : i,
		),
	};
}

/** Store a compiled rule, only if the instruction's text still matches it. */
export function setInstructionRule(
	state: FeedState,
	id: string,
	rule: FeedInstructionRule,
	currentHash: (text: string) => string,
): FeedState {
	return {
		...state,
		instructions: state.instructions.map((i) =>
			i.id === id && currentHash(i.text) === rule.hash ? { ...i, rule } : i,
		),
	};
}

export function removeInstruction(state: FeedState, id: string): FeedState {
	return {
		...state,
		instructions: state.instructions.filter((i) => i.id !== id),
	};
}
