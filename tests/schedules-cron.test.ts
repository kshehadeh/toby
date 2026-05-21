import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { shouldRun } from "../src/schedules/cron";

describe("shouldRun", () => {
	beforeEach(() => {
		vi.stubEnv("TZ", "Etc/UTC");
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	it("runs once latest cron occurrence is strictly after lastRunAt", () => {
		const cron = "0 9 * * *";
		const prevDay = new Date(Date.UTC(2026, 4, 20, 9, 5, 0)).toISOString();
		vi.setSystemTime(new Date(Date.UTC(2026, 4, 21, 12, 0, 0)));
		expect(shouldRun(cron, prevDay, "2026-05-01T00:00:00.000Z")).toBe(true);
	});

	it("does not run again during the same day after lastRun passes the cron tick", () => {
		const cron = "0 9 * * *";
		const wedAfterMorning = new Date(
			Date.UTC(2026, 4, 21, 9, 30, 0),
		).toISOString();
		vi.setSystemTime(new Date(Date.UTC(2026, 4, 21, 12, 0, 0)));
		expect(shouldRun(cron, wedAfterMorning, "2026-05-01T00:00:00.000Z")).toBe(
			false,
		);
	});

	it("with no lastRun, catches up only for ticks at or after schedule creation time", () => {
		const cron = "0 9 * * *";
		const createdWed11 = new Date(
			Date.UTC(2026, 4, 21, 11, 0, 0),
		).toISOString();
		vi.setSystemTime(new Date(Date.UTC(2026, 4, 21, 12, 0, 0)));
		expect(shouldRun(cron, null, createdWed11)).toBe(false);

		const createdWed8 = new Date(Date.UTC(2026, 4, 21, 8, 0, 0)).toISOString();
		expect(shouldRun(cron, null, createdWed8)).toBe(true);
	});

	it("returns false for invalid cron expressions", () => {
		vi.setSystemTime(new Date("2026-05-05T15:00:00.000Z"));
		expect(shouldRun("not a cron", null, "2026-05-01T00:00:00.000Z")).toBe(
			false,
		);
	});
});
