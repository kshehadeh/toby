import { createHash } from "node:crypto";
import type { FeedCandidate } from "./types";

/** A collected item before heuristics run. */
export type RawFeedCandidate = Omit<FeedCandidate, "signals" | "score">;

export const MAX_FEED_CANDIDATES = 40;
export const MAX_CANDIDATES_PER_CATEGORY = 15;

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

function scoreCandidate(c: RawFeedCandidate, now: number): Scored {
	switch (c.category) {
		case "calendar":
			return scoreCalendar(c, now);
		case "email":
			return scoreEmail(c, now);
		case "tasks":
		case "todos":
			return scoreTask(c, now);
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
): FeedCandidate[] {
	const nowMs = now.getTime();
	const seen = new Set<string>();
	const scored: FeedCandidate[] = [];
	for (const c of raw) {
		if (seen.has(c.id)) continue;
		seen.add(c.id);
		const result = scoreCandidate(c, nowMs);
		if (!result) continue;
		scored.push({ ...c, signals: result.signals, score: result.score });
	}
	scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

	const perCategory = new Map<string, number>();
	const out: FeedCandidate[] = [];
	for (const c of scored) {
		const n = perCategory.get(c.category) ?? 0;
		if (n >= MAX_CANDIDATES_PER_CATEGORY) continue;
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
