import { createHash } from "node:crypto";
import type { FeedCandidate } from "./types";

/** A collected item before heuristics run. */
export type RawFeedCandidate = Omit<FeedCandidate, "signals" | "score">;

export const MAX_FEED_CANDIDATES = 40;
export const MAX_CANDIDATES_PER_CATEGORY = 15;
/** Per-category overrides: headlines are context, not work. */
const MAX_CANDIDATES_FOR: Partial<Record<FeedCandidate["category"], number>> = {
	news: 6,
};
/** Chat older than this is dropped (the user has likely seen it). */
const CHAT_HORIZON_MS = 3 * 24 * 60 * 60_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Calendar events that started longer ago than this are treated as past. */
const CALENDAR_PAST_GRACE_MS = 30 * MINUTE;
/** Calendar horizon for the Feed. */
const CALENDAR_HORIZON_MS = 3 * DAY;

const BULK_SENDER =
	/(no-?reply|do-?not-?reply|newsletter|notifications?@|notify@|mailer|marketing|digest|updates?@|news@|info@|hello@|team@|support@)/i;

type Scored = { readonly score: number; readonly signals: string[] } | null;

/** Local `YYYY-MM-DD` for a date (system timezone). */
export function localDateKey(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

function dayDiff(fromKey: string, toKey: string): number {
	const a = Date.parse(`${fromKey}T12:00:00Z`);
	const b = Date.parse(`${toKey}T12:00:00Z`);
	return Math.round((b - a) / DAY);
}

function parseTime(iso: string | undefined): number | null {
	if (!iso) return null;
	const t = Date.parse(iso);
	return Number.isNaN(t) ? null : t;
}

function plural(n: number, unit: string): string {
	return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

function scoreCalendar(c: RawFeedCandidate, now: number): Scored {
	const start = parseTime(c.timestamp);
	if (start === null) return { score: 10, signals: [] };
	const delta = start - now;
	if (delta < -CALENDAR_PAST_GRACE_MS) return null;
	if (delta > CALENDAR_HORIZON_MS) return null;
	const signals: string[] = [];
	let score: number;
	if (delta <= 0) {
		signals.push("in progress");
		score = 60;
	} else if (delta <= HOUR) {
		signals.push(
			`starts in ${plural(Math.max(1, Math.round(delta / MINUTE)), "minute")}`,
		);
		score = 90;
	} else if (delta <= 4 * HOUR) {
		signals.push(`starts in ${plural(Math.round(delta / HOUR), "hour")}`);
		score = 70;
	} else {
		const days = dayDiff(
			localDateKey(new Date(now)),
			localDateKey(new Date(start)),
		);
		if (days === 0) {
			signals.push("later today");
			score = 50;
		} else if (days === 1) {
			signals.push("tomorrow");
			score = 30;
		} else {
			signals.push(`in ${plural(days, "day")}`);
			score = 15;
		}
	}
	if (c.urgency === "high") score += 10;
	return { score, signals };
}

function scoreEmail(c: RawFeedCandidate, now: number): Scored {
	const signals: string[] = [];
	let score = 30;
	if (c.urgency === "high") {
		signals.push("flagged");
		score += 40;
	}
	const received = parseTime(c.timestamp);
	if (received !== null) {
		const age = now - received;
		if (age <= 4 * HOUR) {
			signals.push("received in the last few hours");
			score += 20;
		} else if (age <= DAY) {
			signals.push("received today");
			score += 10;
		} else if (age > 7 * DAY) {
			signals.push(`unread for ${plural(Math.floor(age / DAY), "day")}`);
			score -= 10;
		}
	}
	if (c.subtitle && BULK_SENDER.test(c.subtitle)) {
		signals.push("likely automated or bulk sender");
		score -= 35;
	}
	return { score, signals };
}

function scoreTask(c: RawFeedCandidate, now: number): Scored {
	const signals: string[] = [];
	let score = 20;
	if (c.urgency === "high") {
		signals.push("high priority");
		score += 30;
	}
	const todayKey = localDateKey(new Date(now));
	const dueKey =
		c.dueDate ??
		(parseTime(c.timestamp) !== null
			? localDateKey(new Date(parseTime(c.timestamp) as number))
			: undefined);
	if (dueKey) {
		const days = dayDiff(todayKey, dueKey);
		if (days < 0) {
			signals.push(`overdue by ${plural(-days, "day")}`);
			score += 50;
		} else if (days === 0) {
			signals.push("due today");
			score += 40;
		} else if (days === 1) {
			signals.push("due tomorrow");
			score += 15;
		}
	}
	return { score, signals };
}

function scoreChat(c: RawFeedCandidate, now: number): Scored {
	const signals: string[] = [];
	let score = 40;
	const direct = /direct message/i.test(c.subtitle ?? "");
	if (direct) {
		signals.push("direct message");
		score += 15;
	} else {
		signals.push("mentions the user");
		score += 10;
	}
	if (c.title.includes("?")) {
		signals.push("asks a question");
		score += 10;
	}
	const at = parseTime(c.timestamp);
	if (at !== null) {
		const age = now - at;
		if (age > CHAT_HORIZON_MS) return null;
		if (age <= 2 * HOUR) {
			signals.push("in the last 2 hours");
			score += 15;
		} else if (age <= DAY) {
			signals.push("today");
			score += 5;
		} else {
			signals.push(`${plural(Math.floor(age / DAY), "day")} ago`);
			score -= 10;
		}
	}
	return { score, signals };
}

function scoreNews(c: RawFeedCandidate, now: number): Scored {
	const signals = ["news headline"];
	let score = 5;
	const at = parseTime(c.timestamp);
	if (at !== null && now - at > DAY) {
		return null;
	}
	if (at !== null && now - at <= 3 * HOUR) {
		signals.push("published in the last 3 hours");
		score += 5;
	}
	return { score, signals };
}

/**
 * Key used to learn from "Not relevant" feedback: the item's source within its
 * provider (sender, channel, news section). Null when there is nothing stable.
 */
export function feedbackKeyFor(
	c: Pick<FeedCandidate, "category" | "providerName" | "subtitle">,
): string | null {
	const subtitle = c.subtitle?.trim().toLowerCase();
	if (!subtitle) return null;
	let source = subtitle;
	if (c.category === "email") {
		source = subtitle.match(/<([^>]+)>/)?.[1] ?? subtitle;
	} else if (c.category === "chat") {
		// "@alex · #general" → learn per channel, not per person in a DM.
		const where = subtitle.split("·").map((p) => p.trim());
		source = where[1]?.startsWith("#") ? where[1] : (where[0] ?? subtitle);
	}
	return `${c.category}:${c.providerName}:${source}`;
}

/** Count of "Not relevant" marks per {@link feedbackKeyFor} key. */
export type FeedbackCounts = ReadonlyMap<string, number>;

function feedbackPenalty(
	c: RawFeedCandidate,
	counts: FeedbackCounts | undefined,
): Scored {
	const key = counts && feedbackKeyFor(c);
	const n = key ? (counts.get(key) ?? 0) : 0;
	if (n === 0) return { score: 0, signals: [] };
	return {
		score: n >= 2 ? -30 : -15,
		signals: [
			`the user marked ${plural(n, "similar item")} from this source not relevant`,
		],
	};
}

function scoreCandidate(c: RawFeedCandidate, now: number): Scored {
	switch (c.category) {
		case "calendar":
			return scoreCalendar(c, now);
		case "email":
			return scoreEmail(c, now);
		case "tasks":
		case "todos":
			return scoreTask(c, now);
		case "chat":
			return scoreChat(c, now);
		case "news":
			return scoreNews(c, now);
	}
}

/**
 * Deterministic pre-filter: drop past/out-of-horizon items, de-dupe, attach
 * signals + a heuristic score, then cap per category and overall so the
 * ranking prompt stays small. Returned highest score first.
 */
export function prefilterCandidates(
	raw: readonly RawFeedCandidate[],
	now: Date = new Date(),
	feedback?: FeedbackCounts,
): FeedCandidate[] {
	const nowMs = now.getTime();
	const seen = new Set<string>();
	const scored: FeedCandidate[] = [];
	for (const c of raw) {
		if (seen.has(c.id)) continue;
		seen.add(c.id);
		const result = scoreCandidate(c, nowMs);
		if (!result) continue;
		const penalty = feedbackPenalty(c, feedback);
		scored.push({
			...c,
			signals: [...result.signals, ...(penalty?.signals ?? [])],
			score: result.score + (penalty?.score ?? 0),
		});
	}
	scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

	const perCategory = new Map<string, number>();
	const out: FeedCandidate[] = [];
	for (const c of scored) {
		const n = perCategory.get(c.category) ?? 0;
		if (n >= (MAX_CANDIDATES_FOR[c.category] ?? MAX_CANDIDATES_PER_CATEGORY))
			continue;
		perCategory.set(c.category, n + 1);
		out.push(c);
		if (out.length >= MAX_FEED_CANDIDATES) break;
	}
	return out;
}

/**
 * Stable signature of the candidate set. Excludes time-relative signals so the
 * signature only changes when the underlying items do.
 */
export function candidateSignature(
	candidates: readonly FeedCandidate[],
	extra: readonly string[] = [],
): string {
	const hash = createHash("sha256");
	for (const part of extra) hash.update(`${part}\n`);
	for (const c of [...candidates].sort((a, b) => a.id.localeCompare(b.id))) {
		hash.update(
			`${c.id}|${c.title}|${c.timestamp ?? ""}|${c.dueDate ?? ""}|${c.urgency ?? ""}\n`,
		);
	}
	return hash.digest("hex").slice(0, 32);
}
