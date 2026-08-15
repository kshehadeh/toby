import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearCredentialsCache } from "@toby/core/config/index";
import {
	applyConfigureValuesPatch,
	seedConfigureValues,
} from "@toby/core/configure/persistence";
import type { UserFlowRunResult } from "@toby/core/flows/run-user-flow";
import {
	executeScheduleRun,
	flowScheduleOutput,
	flowScheduleTranscript,
} from "@toby/core/schedules/executor";
import {
	createSchedule,
	getScheduleRun,
	listScheduleRuns,
	listSchedules,
	updateSchedule,
} from "@toby/core/schedules/store";
import {
	NONE_SCHEDULE_FLOW_ID,
	normalizeScheduleFlowId,
	scheduleRunPromptSnapshot,
	scheduleRunsFlow,
} from "@toby/core/schedules/types";
import { closeChatDbForTests } from "@toby/core/session-store";

function makeFlowResult(
	overrides: Partial<UserFlowRunResult> & { ok: boolean },
): UserFlowRunResult {
	const base = {
		flowName: "Morning brief",
		outputs: {},
		nodeTrace: [
			{
				nodeId: "fetch",
				type: "tool_executor" as const,
				order: 0,
				status: "success" as const,
				durationMs: 12,
				startedAt: "2026-08-15T12:00:00.000Z",
				inputs: {},
				bagWrites: {},
			},
		],
		startedAt: "2026-08-15T12:00:00.000Z",
		completedAt: "2026-08-15T12:00:01.000Z",
		durationMs: 1000,
		extracted: {
			text: "Inbox is quiet.",
			format: "markdown" as const,
			pointer: { from: "summary" },
		},
		destinations: [],
	};
	if (overrides.ok) {
		return {
			...base,
			persona: {
				name: "Toby",
				instructions: "",
				promptMode: "add",
			},
			provider: "openai",
			model: "gpt-test",
			...overrides,
		} as UserFlowRunResult;
	}
	return {
		...base,
		error: "Unknown flow",
		extracted: null,
		...overrides,
	} as UserFlowRunResult;
}

describe("schedule flow association", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-sched-flow-"));
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

	it("normalizes flow ids and prompt snapshots", () => {
		expect(normalizeScheduleFlowId(undefined)).toBeNull();
		expect(normalizeScheduleFlowId(NONE_SCHEDULE_FLOW_ID)).toBeNull();
		expect(normalizeScheduleFlowId(" flow.abc ")).toBe("flow.abc");
		const schedule = createSchedule({
			name: "Brief",
			prompt: "unused",
			personaName: "Toby",
			cronExpression: "0 9 * * *",
			flowId: "flow.abc",
		});
		expect(scheduleRunsFlow(schedule)).toBe(true);
		expect(scheduleRunPromptSnapshot(schedule)).toBe("flow:flow.abc");
	});

	it("persists and clears flowId", () => {
		const created = createSchedule({
			name: "Brief",
			prompt: "summarize inbox",
			personaName: "Toby",
			cronExpression: "0 9 * * *",
		});
		expect(created.flowId).toBeNull();

		const updated = updateSchedule(created.id, { flowId: "dashboard.email" });
		expect(updated?.flowId).toBe("dashboard.email");
		expect(listSchedules()[0]?.flowId).toBe("dashboard.email");

		const cleared = updateSchedule(created.id, { flowId: null });
		expect(cleared?.flowId).toBeNull();
	});

	it("clears flowId when configure action is prompt", () => {
		const created = createSchedule({
			name: "Brief",
			prompt: "summarize inbox",
			personaName: "Toby",
			cronExpression: "0 9 * * *",
			flowId: "dashboard.email",
		});
		applyConfigureValuesPatch({
			[`schedules.${created.id}.action`]: "prompt",
		});
		expect(listSchedules()[0]?.flowId).toBeNull();
		const values = seedConfigureValues();
		expect(values[`schedules.${created.id}.action`]).toBe("prompt");
		expect(values[`schedules.${created.id}.flow`]).toBe("(none)");
	});

	it("maps a successful flow result to schedule output and transcript", () => {
		const result = makeFlowResult({ ok: true });
		expect(flowScheduleOutput(result)).toBe("Inbox is quiet.");
		expect(flowScheduleTranscript(result)).toEqual([
			{
				type: "flow_node",
				seq: 0,
				header: "fetch · tool_executor",
				detail: "success",
				durationMs: 12,
			},
		]);
	});

	it("executes a flow schedule without entering the chat path", async () => {
		const schedule = createSchedule({
			name: "Brief",
			prompt: "",
			personaName: "Toby",
			cronExpression: "0 9 * * *",
			flowId: "dashboard.email",
		});
		const { createScheduleRunForExecution } = await import(
			"@toby/core/schedules/executor"
		);
		const createdRunId = createScheduleRunForExecution(schedule);

		let ranFlowId: string | undefined;
		await executeScheduleRun(createdRunId, schedule, {
			runUserFlow: async (id) => {
				ranFlowId = id;
				return makeFlowResult({ ok: true });
			},
		});

		expect(ranFlowId).toBe("dashboard.email");
		const run = getScheduleRun(createdRunId);
		expect(run?.status).toBe("success");
		expect(run?.prompt).toBe("flow:dashboard.email");
		expect(run?.output).toBe("Inbox is quiet.");
		expect(listScheduleRuns(schedule.id, 1)[0]?.status).toBe("success");
	});

	it("fails a flow schedule when the flow is missing", async () => {
		const schedule = createSchedule({
			name: "Brief",
			prompt: "",
			personaName: "Toby",
			cronExpression: "0 9 * * *",
			flowId: "flow.missing",
		});
		const { createScheduleRunForExecution } = await import(
			"@toby/core/schedules/executor"
		);
		const runId = createScheduleRunForExecution(schedule);
		await executeScheduleRun(runId, schedule, {
			runUserFlow: async () =>
				makeFlowResult({ ok: false, error: "Unknown flow" }),
		});
		const run = getScheduleRun(runId);
		expect(run?.status).toBe("error");
		expect(run?.error).toBe("Unknown flow");
	});
});
