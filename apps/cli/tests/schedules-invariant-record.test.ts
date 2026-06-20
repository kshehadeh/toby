import { describe, expect, it, vi } from "vitest";

vi.mock("@toby/core/schedules/store", () => ({
	createScheduleRun: vi.fn(() => "test-run-id"),
	completeScheduleRun: vi.fn(),
	updateScheduleLastRun: vi.fn(),
}));

import { recordScheduleInvariantFailureAndThrow } from "@toby/core/schedules/invariant-record";
import {
	completeScheduleRun,
	createScheduleRun,
	updateScheduleLastRun,
} from "@toby/core/schedules/store";
import type { Schedule } from "../src/schedules/types";

describe("recordScheduleInvariantFailureAndThrow", () => {
	it("writes run + last_run_at and then throws", () => {
		const schedule: Schedule = {
			id: "sid",
			name: "n",
			prompt: "p",
			personaName: "Toby",
			cronExpression: "0 9 * * *",
			enabled: true,
			lastRunAt: null,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		};

		expect(() =>
			recordScheduleInvariantFailureAndThrow(schedule, "boom"),
		).toThrow("boom");

		expect(createScheduleRun).toHaveBeenCalledTimes(1);
		expect(createScheduleRun).toHaveBeenCalledWith({
			scheduleId: "sid",
			personaName: "Toby",
			prompt: "p",
		});
		expect(completeScheduleRun).toHaveBeenCalledWith("test-run-id", {
			status: "error",
			error: "boom",
		});
		expect(updateScheduleLastRun).toHaveBeenCalledWith("sid");
	});
});
