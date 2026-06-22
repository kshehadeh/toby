import {
	humanToCronAsync,
	isValidCronExpression,
} from "@toby/core/schedules/cron-parser";
import { Cron } from "croner";

export { humanToCronAsync, isValidCronExpression };

export function shouldRun(
	cronExpression: string,
	lastRunAt: string | null,
	scheduleCreatedAt: string,
): boolean {
	try {
		const now = new Date();
		const cron = new Cron(cronExpression);
		const lastRun = lastRunAt ? new Date(lastRunAt) : null;

		const previousRuns = cron.previousRuns(1, now);
		const previousRun = previousRuns[0] ?? null;
		if (!previousRun) {
			return lastRunAt === null;
		}

		if (!lastRun) {
			// Catch up only for cron ticks at or after creation time (avoid backfilling
			// slots that predate the schedule). Invalid createdAt ⇒ treat like legacy catch-up (always eligible).
			const created = new Date(scheduleCreatedAt);
			const createdTs = Number.isFinite(created.getTime())
				? created.getTime()
				: Number.NEGATIVE_INFINITY;
			return previousRun.getTime() >= createdTs;
		}

		return previousRun.getTime() > lastRun.getTime();
	} catch {
		return false;
	}
}

export function cronToHuman(cronExpression: string): string {
	const common: Record<string, string> = {
		"* * * * *": "every minute",
		"*/5 * * * *": "every 5 minutes",
		"*/15 * * * *": "every 15 minutes",
		"*/30 * * * *": "every 30 minutes",
		"0 * * * *": "every hour",
		"0 */2 * * *": "every 2 hours",
		"0 */6 * * *": "every 6 hours",
		"0 9 * * *": "every day at 9am",
		"0 9 * * 1-5": "every weekday at 9am",
		"0 9 * * 1": "every Monday at 9am",
		"0 9 1 * *": "monthly on the 1st at 9am",
	};

	const human = common[cronExpression.trim()];
	if (human) {
		return human;
	}

	try {
		const cron = new Cron(cronExpression);
		const next = cron.nextRun();
		if (next) {
			return `${cronExpression} (next: ${next.toLocaleString()})`;
		}
	} catch {
		// fall through
	}

	return cronExpression;
}
