import { shouldRun } from "./cron";
import { executeSchedule } from "./executor";
import { getDueSchedules } from "./store";

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
				if (shouldRun(schedule.cronExpression, schedule.lastRunAt)) {
					fired += 1;
					try {
						await executeSchedule(schedule);
					} catch (error) {
						// eslint-disable-next-line no-console
						console.error(
							`[scheduler] schedule "${schedule.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}
			}
			options.onCycle?.({ checked: due.length, fired });
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error(
				`[scheduler] cycle error: ${error instanceof Error ? error.message : String(error)}`,
			);
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
