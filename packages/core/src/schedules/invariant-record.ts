import {
	completeScheduleRun,
	createScheduleRun,
	updateScheduleLastRun,
} from "./store";
import type { Schedule } from "./types";

/**
 * Persist a failed `schedule_run` row and advances `last_run_at` before throwing,
 * so the daemon scheduler does not re-fire every poll interval.
 */
export function recordScheduleInvariantFailureAndThrow(
	schedule: Schedule,
	message: string,
): never {
	const runId = createScheduleRun({
		scheduleId: schedule.id,
		personaName: schedule.personaName,
		prompt: schedule.prompt,
	});
	completeScheduleRun(runId, { status: "error", error: message });
	updateScheduleLastRun(schedule.id);
	throw new Error(message);
}
