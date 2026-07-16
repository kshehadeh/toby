import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearCredentialsCache } from "@toby/core/config/index";
import {
	getSettingsCache,
	invalidateSettingsCache,
} from "@toby/core/configure/settings-cache";
import {
	completeScheduleRun,
	createSchedule,
	createScheduleRun,
	deleteSchedule,
} from "@toby/core/schedules/store";
import { closeChatDbForTests } from "@toby/core/session-store";

function findRunLabels(
	node: { key?: string; label?: string; children?: unknown[] },
	acc: string[] = [],
): string[] {
	if (node.key?.includes(".runs.") && node.label) {
		acc.push(node.label);
	}
	for (const child of node.children ?? []) {
		findRunLabels(child as typeof node, acc);
	}
	return acc;
}

describe("schedule run settings cache", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;
	let scheduleId: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-sched-cache-"));
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = tempDir;
		clearCredentialsCache();
		closeChatDbForTests();
		invalidateSettingsCache();
		scheduleId = undefined;
	});

	afterEach(() => {
		if (scheduleId) {
			try {
				deleteSchedule(scheduleId);
			} catch {
				// best-effort cleanup
			}
		}
		invalidateSettingsCache();
		closeChatDbForTests();
		clearCredentialsCache();
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("invalidates configure tree when a run completes so status is not stuck on RUNNING", async () => {
		const schedule = createSchedule({
			name: "Cache Test",
			prompt: "do something",
			personaName: "Toby",
			cronExpression: "0 9 * * *",
			enabled: true,
		});
		scheduleId = schedule.id;

		const runId = createScheduleRun({
			scheduleId: schedule.id,
			personaName: "Toby",
			prompt: "do something",
		});

		const whileRunning = await getSettingsCache();
		const warm = await getSettingsCache();
		expect(warm).toBe(whileRunning);

		const runningLabels = findRunLabels(whileRunning.tree);
		expect(runningLabels.some((label) => label.includes("RUNNING"))).toBe(
			true,
		);

		completeScheduleRun(runId, { status: "success", output: "done" });

		const afterComplete = await getSettingsCache();
		expect(afterComplete).not.toBe(whileRunning);

		const successLabels = findRunLabels(afterComplete.tree);
		expect(successLabels.some((label) => label.includes("SUCCESS"))).toBe(
			true,
		);
		expect(successLabels.some((label) => label.includes("RUNNING"))).toBe(
			false,
		);
	});
});
