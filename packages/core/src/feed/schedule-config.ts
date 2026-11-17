import type { DashboardFeedConfig } from "../config/index";

export const DEFAULT_FEED_INTERVAL_MINUTES = 15;
/** Interval choices offered in Settings → Home. */
export const FEED_INTERVAL_CHOICES = [5, 15, 30, 60] as const;
/** Background refresh runs between these local hours (start inclusive, end exclusive). */
export const FEED_ACTIVE_HOURS = { start: 7, end: 22 } as const;

export interface FeedSchedule {
	readonly enabled: boolean;
	readonly intervalMinutes: number;
	readonly notifications: boolean;
}

export function resolveFeedSchedule(
	config: DashboardFeedConfig | undefined,
): FeedSchedule {
	const interval = Number(config?.intervalMinutes);
	return {
		enabled: config?.backgroundRefresh !== false,
		intervalMinutes:
			Number.isFinite(interval) && interval >= 1
				? Math.round(interval)
				: DEFAULT_FEED_INTERVAL_MINUTES,
		notifications: config?.notifications !== false,
	};
}

export function isWithinActiveHours(now: Date): boolean {
	const hour = now.getHours();
	return hour >= FEED_ACTIVE_HOURS.start && hour < FEED_ACTIVE_HOURS.end;
}
