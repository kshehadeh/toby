import { daemonLog } from "@toby/core/logging/daemon-log";
import { shouldRun } from "./cron";
import { executeSchedule } from "./executor";
import { claimScheduleRun, getDueSchedules } from "./store";

interface SchedulerOptions {
	readonly intervalMs: number;
	readonly signal?: AbortSignal;
	readonly onCycle?: (info: { checked: number; fired: number }) => void;
	readonly maxCycles?: number;
}

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return;
	await new Promise<void>((resolve) => {
		const t = setTimeout(resolve, ms);
		const onAbort = () => {
			clearTimeout(t);
			resolve();
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

export async function runSchedulerLoop(
	options: SchedulerOptions,
): Promise<void> {
	const signal = options.signal ?? new AbortController().signal;
	let cycles = 0;

	while (!signal.aborted) {
		cycles += 1;
		let fired = 0;

		try {
			const due = getDueSchedules();
			for (const schedule of due) {
				if (signal.aborted) break;
				if (
					shouldRun(
						schedule.cronExpression,
						schedule.lastRunAt,
						schedule.createdAt,
					)
				) {
					if (!claimScheduleRun(schedule.id, schedule.lastRunAt)) {
						daemonLog("info", "scheduler", "schedule_run_already_claimed", {
							scheduleId: schedule.id,
							name: schedule.name,
						});
						continue;
					}
					fired += 1;
					daemonLog("info", "scheduler", "schedule_run_start", {
						scheduleId: schedule.id,
						name: schedule.name,
					});
					try {
						await executeSchedule(schedule);
						daemonLog("info", "scheduler", "schedule_run_complete", {
							scheduleId: schedule.id,
							name: schedule.name,
						});
					} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						daemonLog("error", "scheduler", "schedule_run_failed", {
							scheduleId: schedule.id,
							name: schedule.name,
							message: msg,
						});
					}
				}
			}
			options.onCycle?.({ checked: due.length, fired });
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			daemonLog("error", "scheduler", "scheduler_cycle_error", {
				message: msg,
			});
		}

		if (options.maxCycles != null && cycles >= options.maxCycles) {
			return;
		}
		if (signal.aborted) {
			return;
		}

		await sleepWithAbort(options.intervalMs, signal);
	}
}
