import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("@toby/core/logging/daemon-log", () => ({
	daemonLog: () => {},
}));

let shouldRunReturn = true;
const mockShouldRun = mock(() => shouldRunReturn);
mock.module("../src/schedules/cron", () => ({
	shouldRun: mockShouldRun,
}));

const mockExecuteSchedule = mock(() => Promise.resolve());
mock.module("../src/schedules/executor", () => ({
	executeSchedule: mockExecuteSchedule,
}));

let getDueSchedulesReturn: unknown[] = [];
const mockGetDueSchedules = mock(() => getDueSchedulesReturn);
let claimScheduleRunReturn = false;
const mockClaimScheduleRun = mock(() => claimScheduleRunReturn);
mock.module("../src/schedules/store", () => ({
	claimScheduleRun: mockClaimScheduleRun,
	getDueSchedules: mockGetDueSchedules,
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
		mockShouldRun.mockClear?.();
		mockExecuteSchedule.mockClear?.();
		mockGetDueSchedules.mockClear?.();
		mockClaimScheduleRun.mockClear?.();
		getDueSchedulesReturn = [schedule];
		claimScheduleRunReturn = false;
	});

	it("executes a due schedule only after claiming it", async () => {
		claimScheduleRunReturn = true;

		await runSchedulerLoop({ intervalMs: 1, maxCycles: 1 });

		expect(claimScheduleRun).toHaveBeenCalledWith(
			schedule.id,
			schedule.lastRunAt,
		);
		expect(executeSchedule).toHaveBeenCalledTimes(1);
		expect(executeSchedule).toHaveBeenCalledWith(schedule);
	});

	it("skips execution when another scheduler already claimed the schedule", async () => {
		claimScheduleRunReturn = false;

		await runSchedulerLoop({ intervalMs: 1, maxCycles: 1 });

		expect(claimScheduleRun).toHaveBeenCalledTimes(1);
		expect(executeSchedule).not.toHaveBeenCalled();
	});
});
