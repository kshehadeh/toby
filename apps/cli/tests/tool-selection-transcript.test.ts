import { beforeEach, describe, expect, it, vi } from "vitest";

const logSessionNote = vi.fn();

vi.mock("@toby/core/logging/chat-log", () => ({
	logSessionNote: (...args: unknown[]) => logSessionNote(...args),
}));

import {
	buildSelectionTranscriptEntries,
	summarizeToolCountsByIntegration,
	logToolSelectionNotes,
} from "../src/ui/chat/tool-selection-transcript";

describe("tool selection notes", () => {
	const labels = {
		fetchOpenTasks: "Todoist",
		listProjectNames: "Todoist",
		getInboxUnreadOverview: "Gmail",
		memorySearch: "Toby",
		askUser: "Toby",
	};

	beforeEach(() => {
		logSessionNote.mockClear();
	});

	it("logs nothing when pretreatment did not run", () => {
		logToolSelectionNotes("sess-1", {
			allToolNames: Object.keys(labels),
			toolIntegrationLabels: labels,
			relevantTools: ["fetchOpenTasks"],
			pretreatmentRan: false,
		});
		expect(logSessionNote).not.toHaveBeenCalled();
	});

	it("summarizes full catalog when pretreatment ran but did not narrow tools", () => {
		const summary = summarizeToolCountsByIntegration({
			allToolNames: Object.keys(labels),
			toolIntegrationLabels: labels,
			relevantTools: [],
		});
		expect(summary).toEqual([
			{ label: "Gmail", count: 1 },
			{ label: "Toby", count: 2 },
			{ label: "Todoist", count: 2 },
		]);

		logToolSelectionNotes("sess-1", {
			allToolNames: Object.keys(labels),
			toolIntegrationLabels: labels,
			relevantTools: [],
			pretreatmentRan: true,
		});
		expect(logSessionNote).toHaveBeenCalledTimes(3);
		expect(logSessionNote).toHaveBeenCalledWith(
			"sess-1",
			"Tools in scope: Gmail (1)",
		);
		expect(logSessionNote).toHaveBeenCalledWith(
			"sess-1",
			"Tools in scope: Toby (2)",
		);
		expect(logSessionNote).toHaveBeenCalledWith(
			"sess-1",
			"Tools in scope: Todoist (2)",
		);
	});

	it("summarizes narrowed tools including always-included Toby tools", () => {
		logToolSelectionNotes(null, {
			allToolNames: Object.keys(labels),
			toolIntegrationLabels: labels,
			relevantTools: ["fetchOpenTasks"],
			pretreatmentRan: true,
		});
		expect(logSessionNote).toHaveBeenCalledWith(
			null,
			"Tools selected: Toby (2)",
		);
		expect(logSessionNote).toHaveBeenCalledWith(
			null,
			"Tools selected: Todoist (1)",
		);
	});

	it("includes plugin integration labels in summaries", () => {
		const pluginLabels = {
			...labels,
			sampleEcho: "Sample Plugin",
		};
		logToolSelectionNotes("s2", {
			allToolNames: Object.keys(pluginLabels),
			toolIntegrationLabels: pluginLabels,
			relevantTools: ["sampleEcho"],
			pretreatmentRan: true,
		});
		expect(logSessionNote).toHaveBeenCalledWith(
			"s2",
			"Tools selected: Sample Plugin (1)",
		);
	});
});

describe("buildSelectionTranscriptEntries", () => {
	it("returns empty when pretreatment did not run", () => {
		const entries = buildSelectionTranscriptEntries({
			relevantSkills: ["my-skill"],
			allToolNames: ["fetchOpenTasks"],
			toolIntegrationLabels: { fetchOpenTasks: "Todoist" },
			relevantTools: ["fetchOpenTasks"],
			pretreatmentRan: false,
		});
		expect(entries).toEqual([]);
	});

	it("shows selected skills", () => {
		const entries = buildSelectionTranscriptEntries({
			relevantSkills: ["inbox-triage", "draft-reply"],
			allToolNames: [],
			toolIntegrationLabels: {},
			relevantTools: [],
			pretreatmentRan: true,
		});
		expect(entries).toHaveLength(1);
		expect(entries[0]).toEqual({
			kind: "notice",
			text: "Skills: inbox-triage, draft-reply",
			tone: "info",
		});
	});

	it("shows tool count and first few non-global tools", () => {
		const entries = buildSelectionTranscriptEntries({
			relevantSkills: [],
			allToolNames: [
				"fetchOpenTasks",
				"listProjectNames",
				"memorySearch",
				"askUser",
				"sendEmail",
			],
			toolIntegrationLabels: {
				fetchOpenTasks: "Todoist",
				listProjectNames: "Todoist",
				sendEmail: "Gmail",
				memorySearch: "Toby",
				askUser: "Toby",
			},
			relevantTools: ["fetchOpenTasks", "listProjectNames", "sendEmail"],
			pretreatmentRan: true,
		});
		expect(entries).toHaveLength(1);
		expect(entries[0].kind).toBe("notice");
		// 3 non-global (fetchOpenTasks, listProjectNames, sendEmail) + 2 global (memorySearch, askUser)
		expect((entries[0] as { text: string }).text).toMatch(/^5 tools:/);
		expect((entries[0] as { text: string }).text).toContain("fetchOpenTasks");
	});

	it("shows only core tools label when all tools are global", () => {
		const entries = buildSelectionTranscriptEntries({
			relevantSkills: [],
			allToolNames: ["memorySearch", "askUser"],
			toolIntegrationLabels: { memorySearch: "Toby", askUser: "Toby" },
			relevantTools: [],
			pretreatmentRan: true,
		});
		expect(entries).toHaveLength(1);
		expect((entries[0] as { text: string }).text).toBe("2 core tools");
	});

	it("shows both skills and tools", () => {
		const entries = buildSelectionTranscriptEntries({
			relevantSkills: ["inbox-triage"],
			allToolNames: ["fetchOpenTasks", "memorySearch", "askUser"],
			toolIntegrationLabels: {
				fetchOpenTasks: "Todoist",
				memorySearch: "Toby",
				askUser: "Toby",
			},
			relevantTools: ["fetchOpenTasks"],
			pretreatmentRan: true,
		});
		expect(entries).toHaveLength(2);
		expect((entries[0] as { text: string }).text).toBe("Skills: inbox-triage");
		expect((entries[1] as { text: string }).text).toMatch(/^3 tools:/);
	});

	it("truncates non-global tool names after 3", () => {
		const allNames = [
			"tool1",
			"tool2",
			"tool3",
			"tool4",
			"tool5",
			"memorySearch",
		];
		const labels: Record<string, string> = {};
		for (const n of allNames) labels[n] = "Plugin";
		labels.memorySearch = "Toby";

		const entries = buildSelectionTranscriptEntries({
			relevantSkills: [],
			allToolNames: allNames,
			toolIntegrationLabels: labels,
			relevantTools: allNames.filter((n) => n !== "memorySearch"),
			pretreatmentRan: true,
		});
		expect(entries).toHaveLength(1);
		const text = (entries[0] as { text: string }).text;
		expect(text).toContain("tool1, tool2, tool3");
		expect(text).toContain("+2 more");
	});
});
