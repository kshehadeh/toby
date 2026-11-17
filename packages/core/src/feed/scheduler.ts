import { readConfig } from "../config/index";
import { daemonLog } from "../logging/daemon-log";
import { resolveNativePort } from "../native-app/client";
import { getFeedContent } from "./index";
import {
	type FeedSchedule,
	isWithinActiveHours,
	resolveFeedSchedule,
} from "./schedule-config";
import { loadFeedState, markNotified, updateFeedState } from "./state";
import type { FeedContent, FeedItem } from "./types";

export {
	DEFAULT_FEED_INTERVAL_MINUTES,
	FEED_ACTIVE_HOURS,
	isWithinActiveHours,
	resolveFeedSchedule,
} from "./schedule-config";
export type { FeedSchedule } from "./schedule-config";

/** First background run after daemon start. */
const STARTUP_DELAY_MS = 60_000;
/** Cap notifications per run; more new items collapse into one summary. */
const MAX_INDIVIDUAL_NOTIFICATIONS = 1;

/** "Now" items that haven't been notified yet. */
export function newNowItems(
	content: FeedContent,
	notified: Readonly<Record<string, string>>,
): FeedItem[] {
	if (content.status !== "ok") return [];
	return content.items.filter(
		(item) => item.tier === "now" && notified[item.id] === undefined,
	);
}

export interface FeedNotification {
	readonly title: string;
	readonly body: string;
	readonly itemId?: string;
}

/** One notification for a single new item; a summary for several. */
export function feedNotificationFor(
	items: readonly FeedItem[],
): FeedNotification | null {
	if (items.length === 0) return null;
	const [first] = items;
	if (items.length <= MAX_INDIVIDUAL_NOTIFICATIONS && first) {
		return { title: first.title, body: first.reason, itemId: first.id };
	}
	const titles = items.slice(0, 3).map((i) => i.title);
	const more = items.length > 3 ? `, and ${items.length - 3} more` : "";
	return {
		title: `${items.length} things need your attention now`,
		body: `${titles.join(", ")}${more}.`,
	};
}

async function postNativeFeedNotification(
	notification: FeedNotification,
): Promise<boolean> {
	const port = resolveNativePort();
	if (!port) return false;
	try {
		const response = await fetch(
			`http://127.0.0.1:${port}/api/native/feed/notification`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(notification),
				signal: AbortSignal.timeout(5000),
			},
		);
		const payload = (await response.json()) as { ok?: boolean };
		return response.ok && payload.ok === true;
	} catch {
		return false;
	}
}

export interface FeedRunDeps {
	readonly getFeed: () => Promise<FeedContent>;
	readonly notify: (notification: FeedNotification) => Promise<boolean>;
	readonly now: () => Date;
}

/**
 * One background refresh: rebuild the Feed (re-ranking only when candidates
 * changed or the ranking is stale) and notify about new "Now" items.
 *
 * Items are marked notified only after the app accepted the notification, so
 * a closed app doesn't swallow them.
 */
export async function runFeedBackgroundRefresh(
	schedule: FeedSchedule,
	deps: Partial<FeedRunDeps> = {},
): Promise<{ content: FeedContent; notified: number }> {
	const d: FeedRunDeps = {
		getFeed: () => getFeedContent({ awaitRerank: true, trigger: "schedule" }),
		notify: postNativeFeedNotification,
		now: () => new Date(),
		...deps,
	};
	const content = await d.getFeed();
	if (!schedule.notifications) return { content, notified: 0 };

	const now = d.now();
	const fresh = newNowItems(content, loadFeedState(now).notified);
	const notification = feedNotificationFor(fresh);
	if (!notification) return { content, notified: 0 };
	const delivered = await d.notify(notification);
	if (delivered) {
		updateFeedState(
			(s) =>
				markNotified(
					s,
					fresh.map((i) => i.id),
					now.toISOString(),
				),
			now,
		);
	}
	return { content, notified: delivered ? fresh.length : 0 };
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

/**
 * Daemon loop: refresh The Feed every `intervalMinutes` during active hours.
 * Config is re-read each tick so Settings changes apply without a restart.
 */
export async function runFeedScheduler(params: {
	readonly signal: AbortSignal;
}): Promise<void> {
	const { signal } = params;
	await pause(STARTUP_DELAY_MS, signal);
	while (!signal.aborted) {
		const schedule = resolveFeedSchedule(readConfig().dashboard?.feed);
		if (schedule.enabled && isWithinActiveHours(new Date())) {
			try {
				const result = await runFeedBackgroundRefresh(schedule);
				daemonLog("debug", "general", "feed_background_refresh", {
					status: result.content.status,
					items: result.content.items.length,
					notified: result.notified,
				});
			} catch (error) {
				daemonLog("warn", "general", "feed_background_refresh_error", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		await pause(schedule.intervalMinutes * 60_000, signal);
	}
}
