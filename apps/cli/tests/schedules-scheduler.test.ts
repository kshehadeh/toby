import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/logging/daemon-log", () => ({
	daemonLog: vi.fn(),
}));

vi.mock("../src/schedules/cron", () => ({
	shouldRun: vi.fn(() => true),
}));

vi.mock("../src/schedules/executor", () => ({
	executeSchedule: vi.fn(),
}));

vi.mock("../src/schedules/store", () => ({
	claimScheduleRun: vi.fn(),
	getDueSchedules: vi.fn(),
}));

import { executeSchedule } from "../src/schedules/executor";
import { runSchedulerLoop } from "../src/schedules/scheduler";
import { claimScheduleRun, getDueSchedules } from "../src/schedules/store";
import type { Schedule } from "../src/schedules/types";

const schedule: Schedule = {
	id: "schedule-1",
	name: "Inbox summary",
	prompt: "Summarize inbox",
	personaName: "Toby",
	cronExpression: "* * * * *",
	enabled: true,
	lastRunAt: "2026-05-24T11:59:00.000Z",
	createdAt: "2026-05-24T11:00:00.000Z",
	updatedAt: "2026-05-24T11:00:00.000Z",
};

describe("runSchedulerLoop", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getDueSchedules).mockReturnValue([schedule]);
	});

	it("executes a due schedule only after claiming it", async () => {
		vi.mocked(claimScheduleRun).mockReturnValue(true);

		await runSchedulerLoop({ intervalMs: 1, maxCycles: 1 });

		expect(claimScheduleRun).toHaveBeenCalledWith(
			schedule.id,
			schedule.lastRunAt,
		);
		expect(executeSchedule).toHaveBeenCalledTimes(1);
		expect(executeSchedule).toHaveBeenCalledWith(schedule);
	});

	it("skips execution when another scheduler already claimed the schedule", async () => {
		vi.mocked(claimScheduleRun).mockReturnValue(false);

		await runSchedulerLoop({ intervalMs: 1, maxCycles: 1 });

		expect(claimScheduleRun).toHaveBeenCalledTimes(1);
		expect(executeSchedule).not.toHaveBeenCalled();
	});
});
