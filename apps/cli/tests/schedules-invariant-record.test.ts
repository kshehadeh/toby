import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearCredentialsCache } from "@toby/core/config/index";
import { recordScheduleInvariantFailureAndThrow } from "@toby/core/schedules/invariant-record";
import {
	createSchedule,
	getScheduleRun,
	listScheduleRuns,
	listSchedules,
} from "@toby/core/schedules/store";
import type { Schedule } from "@toby/core/schedules/types";
import { closeChatDbForTests } from "@toby/core/session-store";

describe("recordScheduleInvariantFailureAndThrow", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-sched-invariant-"));
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = tempDir;
		clearCredentialsCache();
		closeChatDbForTests();
	});

	afterEach(() => {
		closeChatDbForTests();
		clearCredentialsCache();
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("writes run + last_run_at and then throws", () => {
		const created = createSchedule({
			name: "n",
			prompt: "p",
			personaName: "Toby",
			cronExpression: "0 9 * * *",
			enabled: true,
		});
		const schedule: Schedule = {
			id: created.id,
			name: "n",
			prompt: "p",
			personaName: "Toby",
			cronExpression: "0 9 * * *",
			projectId: null,
			enabled: true,
			lastRunAt: null,
			createdAt: created.createdAt,
			updatedAt: created.updatedAt,
		};

		expect(() =>
			recordScheduleInvariantFailureAndThrow(schedule, "boom"),
		).toThrow("boom");

		const runs = listScheduleRuns(created.id, 5);
		expect(runs).toHaveLength(1);
		expect(runs[0]?.status).toBe("error");
		expect(runs[0]?.error).toBe("boom");
		expect(getScheduleRun(runs[0]!.id)?.status).toBe("error");

		const updated = listSchedules().find((s) => s.id === created.id);
		expect(updated?.lastRunAt).toBeTruthy();
	});
});
