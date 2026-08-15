import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	getFlowDashboardContent,
	listFlowDashboardBlocks,
} from "@toby/core/dashboard/flow-blocks";
import {
	type FlowDocument,
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
		expect(blocks[0]?.showsResultSheet).toBe(true);
		expect(blocks[1]?.showsResultSheet).toBe(false);
		expect(blocks[2]?.title).toBe("Focus mode");
	});

	it("soft informational content uses the last successful run", async () => {
		saveUserFlowDocument(infoDoc);
		const empty = await getFlowDashboardContent("flow.test.info");
		expect(empty?.text).toBe("");
		expect(empty?.count).toBe(0);

		const runId = createFlowRun({
			flowName: "flow.test.info",
			personaName: "Toby",
			definitionSnapshot: { name: "flow.test.info", nodes: [] },
		});
		expect(runId).toBeTruthy();
		completeFlowRun({
			id: runId as string,
			status: "success",
			finalOutputs: { summary: { markdown: "## Inbox\n- **Standup**" } },
			durationMs: 10,
		});

		const content = await getFlowDashboardContent("flow.test.info");
		expect(content?.text).toBe("## Inbox\n- **Standup**");
		expect(content?.count).toBe(1);
		expect(content?.personaName).toBe("Toby");
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
