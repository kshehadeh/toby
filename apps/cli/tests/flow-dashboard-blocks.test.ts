import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DASHBOARD_CONTENT_TTL_MS } from "@toby/core/dashboard/cache-ttl";
import {
	getFlowDashboardContent,
	listFlowDashboardBlocks,
} from "@toby/core/dashboard/flow-blocks";
import {
	type FlowDocument,
	type UserFlowRunResult,
	completeFlowRun,
	createFlowRun,
	saveUserFlowDocument,
} from "@toby/core/flows";
import { closeChatDbForTests } from "@toby/core/session-store";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "toby-flow-dash-"));
}

const runnerDoc: FlowDocument = {
	id: "flow.test.runner",
	name: "Focus mode",
	description: "Turn off Wi-Fi",
	icon: "flame",
	destinations: [{ type: "dashboard", variant: "runner" }],
	nodes: [
		{
			id: "wifi",
			type: "tool_executor",
			tool: { moduleName: "macos", toolName: "macWifiSetPower" },
			inputs: { enabled: { const: false } },
		},
	],
};

const infoDoc: FlowDocument = {
	id: "flow.test.info",
	name: "Status note",
	description: "Latest status",
	destinations: [{ type: "dashboard", variant: "informational" }],
	nodes: [
		{
			id: "note",
			type: "llm_prompter",
			schema: { kind: "markdown" },
			systemPrompt: "Write a line.",
			userPrompt: "Hello",
			outputs: { summary: "object" },
		},
	],
};

function seedSuccess(
	flowId: string,
	markdown: string,
	completedAt: string,
): void {
	const runId = createFlowRun({
		flowName: flowId,
		personaName: "Toby",
		definitionSnapshot: { name: flowId, nodes: [] },
		startedAt: completedAt,
	});
	expect(runId).toBeTruthy();
	completeFlowRun({
		id: runId as string,
		status: "success",
		finalOutputs: { summary: { markdown } },
		durationMs: 10,
		completedAt,
	});
}

function fakeOkRun(flowId: string, text: string): UserFlowRunResult {
	const now = new Date().toISOString();
	return {
		ok: true,
		flowName: flowId,
		persona: { name: "Toby" },
		provider: "test",
		model: "test",
		outputs: { summary: { markdown: text } },
		nodeTrace: [],
		startedAt: now,
		completedAt: now,
		durationMs: 1,
		extracted: { text, format: "markdown", pointer: { from: "summary" } },
		destinations: [],
	} as UserFlowRunResult;
}

describe("listFlowDashboardBlocks", () => {
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = makeTempDir();
	});

	afterEach(() => {
		closeChatDbForTests();
		const dir = process.env.TOBY_DIR;
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		if (dir && fs.existsSync(dir)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("lists only custom flows with a dashboard destination", () => {
		saveUserFlowDocument(runnerDoc);
		saveUserFlowDocument(infoDoc);
		saveUserFlowDocument({
			...infoDoc,
			id: "flow.test.no-dash",
			name: "Hidden",
			destinations: [{ type: "modal" }],
		});
		saveUserFlowDocument({
			...infoDoc,
			id: "flow.test.both",
			name: "Both",
			destinations: [
				{ type: "modal" },
				{ type: "dashboard", variant: "informational" },
			],
		});
		const blocks = listFlowDashboardBlocks();
		expect(blocks.map((b) => b.id)).toEqual([
			"flow.test.both",
			"flow.test.info",
			"flow.test.runner",
		]);
		expect(blocks.map((b) => b.variant)).toEqual([
			"informational",
			"informational",
			"runner",
		]);
		expect(blocks.map((b) => b.refresh)).toEqual([
			"asNeeded",
			"asNeeded",
			"manual",
		]);
		expect(blocks[0]?.showsResultSheet).toBe(true);
		expect(blocks[1]?.showsResultSheet).toBe(false);
		expect(blocks[2]?.title).toBe("Focus mode");
		expect(blocks[2]?.icon).toBe("flame");
		expect(blocks[1]?.icon).toBeNull();
	});

	it("resolves explicit informational refresh on the list payload", () => {
		saveUserFlowDocument({
			...infoDoc,
			id: "flow.test.manual",
			name: "Manual note",
			destinations: [
				{ type: "dashboard", variant: "informational", refresh: "manual" },
			],
		});
		const blocks = listFlowDashboardBlocks();
		expect(blocks[0]?.refresh).toBe("manual");
	});

	it("soft informational content uses the last successful run", async () => {
		saveUserFlowDocument({
			...infoDoc,
			destinations: [
				{ type: "dashboard", variant: "informational", refresh: "manual" },
			],
		});
		const empty = await getFlowDashboardContent("flow.test.info");
		expect(empty?.text).toBe("");
		expect(empty?.count).toBe(0);

		seedSuccess(
			"flow.test.info",
			"## Inbox\n- **Standup**",
			new Date().toISOString(),
		);

		const content = await getFlowDashboardContent("flow.test.info");
		expect(content?.text).toBe("## Inbox\n- **Standup**");
		expect(content?.count).toBe(1);
		expect(content?.personaName).toBe("Toby");
	});

	it("as-needed soft skips a rerun when the last success is fresh", async () => {
		saveUserFlowDocument(infoDoc);
		const completedAt = new Date().toISOString();
		seedSuccess("flow.test.info", "## Fresh", completedAt);
		const runUserFlow = mock(async () => fakeOkRun("flow.test.info", "## New"));
		const content = await getFlowDashboardContent("flow.test.info", {
			runUserFlow,
			now: Date.parse(completedAt) + 1_000,
		});
		expect(content?.text).toBe("## Fresh");
		expect(runUserFlow).toHaveBeenCalledTimes(0);
	});

	it("as-needed soft returns last success and reruns when stale", async () => {
		saveUserFlowDocument(infoDoc);
		const completedAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
		seedSuccess("flow.test.info", "## Stale", completedAt);
		const runUserFlow = mock(async () => fakeOkRun("flow.test.info", "## New"));
		const content = await getFlowDashboardContent("flow.test.info", {
			runUserFlow,
			now: Date.parse(completedAt) + DASHBOARD_CONTENT_TTL_MS + 1,
		});
		expect(content?.text).toBe("## Stale");
		expect(runUserFlow).toHaveBeenCalledTimes(1);
		expect(runUserFlow.mock.calls[0]?.[1]).toMatchObject({
			deliverDestinations: false,
			trigger: "dashboard.flow:flow.test.info",
		});
	});

	it("as-needed soft awaits a run when the flow has never succeeded", async () => {
		saveUserFlowDocument(infoDoc);
		const runUserFlow = mock(async () =>
			fakeOkRun("flow.test.info", "## First"),
		);
		const content = await getFlowDashboardContent("flow.test.info", {
			runUserFlow,
		});
		expect(content?.text).toBe("## First");
		expect(runUserFlow).toHaveBeenCalledTimes(1);
	});

	it("omitted refresh behaves as as-needed", async () => {
		saveUserFlowDocument(infoDoc);
		const runUserFlow = mock(async () =>
			fakeOkRun("flow.test.info", "## First"),
		);
		await getFlowDashboardContent("flow.test.info", { runUserFlow });
		expect(runUserFlow).toHaveBeenCalledTimes(1);
	});

	it("manual soft never reruns", async () => {
		saveUserFlowDocument({
			...infoDoc,
			destinations: [
				{ type: "dashboard", variant: "informational", refresh: "manual" },
			],
		});
		const completedAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
		seedSuccess("flow.test.info", "## Old", completedAt);
		const runUserFlow = mock(async () => fakeOkRun("flow.test.info", "## New"));
		const content = await getFlowDashboardContent("flow.test.info", {
			runUserFlow,
			now: Date.parse(completedAt) + DASHBOARD_CONTENT_TTL_MS + 1,
		});
		expect(content?.text).toBe("## Old");
		expect(runUserFlow).toHaveBeenCalledTimes(0);
	});

	it("force reruns informational cards for both refresh policies", async () => {
		saveUserFlowDocument({
			...infoDoc,
			destinations: [
				{ type: "dashboard", variant: "informational", refresh: "manual" },
			],
		});
		seedSuccess("flow.test.info", "## Old", new Date().toISOString());
		const runUserFlow = mock(async () => fakeOkRun("flow.test.info", "## New"));
		const content = await getFlowDashboardContent("flow.test.info", {
			force: true,
			runUserFlow,
		});
		expect(content?.text).toBe("## New");
		expect(runUserFlow).toHaveBeenCalledTimes(1);
	});

	it("coalesces concurrent informational dashboard runs", async () => {
		saveUserFlowDocument(infoDoc);
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const runUserFlow = mock(async () => {
			await gate;
			return fakeOkRun("flow.test.info", "## Once");
		});
		const first = getFlowDashboardContent("flow.test.info", {
			force: true,
			runUserFlow,
		});
		const second = getFlowDashboardContent("flow.test.info", {
			force: true,
			runUserFlow,
		});
		release?.();
		const [a, b] = await Promise.all([first, second]);
		expect(a?.text).toBe("## Once");
		expect(b?.text).toBe("## Once");
		expect(runUserFlow).toHaveBeenCalledTimes(1);
	});

	it("runner content never runs and stays empty-bodied", async () => {
		saveUserFlowDocument(runnerDoc);
		const soft = await getFlowDashboardContent("flow.test.runner");
		const force = await getFlowDashboardContent("flow.test.runner", {
			force: true,
		});
		expect(soft?.text).toBe("");
		expect(force?.text).toBe("");
		expect(soft?.category).toBe("flow.test.runner");
	});

	it("returns null for unknown or built-in ids", async () => {
		expect(await getFlowDashboardContent("dashboard.email.summary")).toBeNull();
		expect(await getFlowDashboardContent("flow.missing")).toBeNull();
	});
});
