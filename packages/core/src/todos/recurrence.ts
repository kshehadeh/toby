import { Cron } from "croner";
import type { Due, Recurrence } from "./types";

export function localDateTime(
	at: Date,
	timezone: string,
): { date: string; time: string } {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(at);
	const part = (type: string) =>
		parts.find((p) => p.type === type)?.value ?? "";
	return {
		date: `${part("year")}-${part("month")}-${part("day")}`,
		time: `${part("hour")}:${part("minute")}`,
	};
}

/** Earlier offset on overlaps; move forward by the gap for nonexistent times. */
export function dueInstant(due: Due): Date | null {
	if (!due.time) return null;
	const target = `${due.date}T${due.time}`;
	const nominal = new Date(`${target}:00Z`).getTime();
	const offsets = new Set<number>();
	for (const hours of [-36, -12, 0, 12, 36]) {
		const instant = new Date(nominal + hours * 3600000);
		const wall = localDateTime(instant, due.timezone);
		offsets.add(
			new Date(`${wall.date}T${wall.time}:00Z`).getTime() - instant.getTime(),
		);
	}
	const candidates = [...offsets].map((offset) => new Date(nominal - offset));
	const exact = candidates
		.filter((at) => {
			const wall = localDateTime(at, due.timezone);
			return `${wall.date}T${wall.time}` === target;
		})
		.sort((a, b) => a.getTime() - b.getTime());
	if (exact[0]) return exact[0];
	return (
		candidates
			.filter((at) => {
				const wall = localDateTime(at, due.timezone);
				return `${wall.date}T${wall.time}` > target;
			})
			.sort((a, b) => a.getTime() - b.getTime())[0] ?? null
	);
}

function dateAdd(
	anchor: string,
	unit: Recurrence["unit"],
	count: number,
): string {
	const date = new Date(`${anchor}T12:00:00Z`);
	const day = date.getUTCDate();
	if (unit === "day" || unit === "week") {
		date.setUTCDate(day + count * (unit === "week" ? 7 : 1));
	} else {
		date.setUTCDate(1);
		date.setUTCMonth(date.getUTCMonth() + count * (unit === "year" ? 12 : 1));
		const last = new Date(
			Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
		).getUTCDate();
		date.setUTCDate(Math.min(day, last));
	}
	return date.toISOString().slice(0, 10);
}

export function isOverdue(due: Due | null, now = new Date()): boolean {
	if (!due) return false;
	const instant = dueInstant(due);
	return instant
		? instant.getTime() < now.getTime()
		: due.date < localDateTime(now, due.timezone).date;
}

export function nextDue(
	anchor: Due,
	current: Due,
	rule: Recurrence,
	completedAt: string,
): Due | null {
	const completed = new Date(completedAt);
	const local = localDateTime(completed, anchor.timezone);
	let next: Due;
	if (rule.mode === "completion") {
		next = {
			...anchor,
			date: dateAdd(local.date, rule.unit, rule.interval),
			time: anchor.time ? local.time : null,
		};
	} else if (rule.weekdays?.length) {
		const weekdays = [...new Set(rule.weekdays)].sort();
		const cron = new Cron(
			`0 ${anchor.time?.slice(3) ?? "0"} ${anchor.time?.slice(0, 2) ?? "12"} * * ${weekdays.join(",")}`,
			{ timezone: anchor.timezone },
		);
		const after = new Date(
			Math.max(
				completed.getTime(),
				dueInstant({ ...current, time: current.time ?? "23:59" })?.getTime() ??
					0,
			),
		);
		let candidate = cron.nextRun(after);
		const anchorDay = new Date(`${anchor.date}T12:00:00Z`);
		anchorDay.setUTCDate(anchorDay.getUTCDate() - anchorDay.getUTCDay());
		while (candidate) {
			const wall = localDateTime(candidate, anchor.timezone);
			const days = Math.floor(
				(new Date(`${wall.date}T12:00:00Z`).getTime() - anchorDay.getTime()) /
					86400000,
			);
			if (Math.floor(days / 7) % rule.interval === 0) break;
			candidate = cron.nextRun(candidate);
		}
		if (!candidate) return null;
		next = { ...anchor, date: localDateTime(candidate, anchor.timezone).date };
	} else {
		const threshold = current.date > local.date ? current.date : local.date;
		const a = new Date(`${anchor.date}T12:00:00Z`);
		const b = new Date(`${threshold}T12:00:00Z`);
		const distance =
			rule.unit === "year"
				? b.getUTCFullYear() - a.getUTCFullYear()
				: rule.unit === "month"
					? (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
						b.getUTCMonth() -
						a.getUTCMonth()
					: Math.floor(
							(b.getTime() - a.getTime()) /
								86400000 /
								(rule.unit === "week" ? 7 : 1),
						);
		let step = Math.max(1, Math.floor(distance / rule.interval));
		next = {
			...anchor,
			date: dateAdd(anchor.date, rule.unit, step * rule.interval),
		};
		while (
			next.date <= current.date ||
			(next.time
				? (dueInstant(next)?.getTime() ?? 0) <= completed.getTime()
				: next.date <= local.date)
		) {
			step++;
			next = {
				...anchor,
				date: dateAdd(anchor.date, rule.unit, step * rule.interval),
			};
		}
	}
	return rule.endDate && next.date > rule.endDate ? null : next;
}
