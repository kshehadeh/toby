import { beforeEach, describe, expect, it, vi } from "vitest";

const logSessionNote = vi.fn();

vi.mock("@toby/core/logging/chat-log", () => ({
	logSessionNote: (...args: unknown[]) => logSessionNote(...args),
}));

import {
	logToolSelectionNotes,
	summarizeToolCountsByIntegration,
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
