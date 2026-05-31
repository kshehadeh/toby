import { describe, expect, it } from "vitest";
import {
	buildToolSelectionTranscriptEntries,
	summarizeToolCountsByIntegration,
} from "../src/ui/chat/tool-selection-transcript";

describe("tool selection transcript", () => {
	const labels = {
		fetchOpenTasks: "Todoist",
		listProjectNames: "Todoist",
		getInboxUnreadOverview: "Gmail",
		memorySearch: "Toby",
		askUser: "Toby",
	};

	it("returns no entries when pretreatment did not run", () => {
		expect(
			buildToolSelectionTranscriptEntries({
				allToolNames: Object.keys(labels),
				toolIntegrationLabels: labels,
				relevantTools: ["fetchOpenTasks"],
				pretreatmentRan: false,
			}),
		).toEqual([]);
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

		const entries = buildToolSelectionTranscriptEntries({
			allToolNames: Object.keys(labels),
			toolIntegrationLabels: labels,
			relevantTools: [],
			pretreatmentRan: true,
		});
		expect(entries).toEqual([
			{ kind: "meta", text: "Tools in scope: Gmail (1)" },
			{ kind: "meta", text: "Tools in scope: Toby (2)" },
			{ kind: "meta", text: "Tools in scope: Todoist (2)" },
		]);
	});

	it("summarizes narrowed tools including always-included Toby tools", () => {
		const entries = buildToolSelectionTranscriptEntries({
			allToolNames: Object.keys(labels),
			toolIntegrationLabels: labels,
			relevantTools: ["fetchOpenTasks"],
			pretreatmentRan: true,
		});
		expect(entries).toEqual([
			{ kind: "meta", text: "Tools selected: Toby (2)" },
			{ kind: "meta", text: "Tools selected: Todoist (1)" },
		]);
	});

	it("includes plugin integration labels in summaries", () => {
		const pluginLabels = {
			...labels,
			sampleEcho: "Sample Plugin",
		};
		const entries = buildToolSelectionTranscriptEntries({
			allToolNames: Object.keys(pluginLabels),
			toolIntegrationLabels: pluginLabels,
			relevantTools: ["sampleEcho"],
			pretreatmentRan: true,
		});
		expect(entries).toEqual([
			{ kind: "meta", text: "Tools selected: Sample Plugin (1)" },
			{ kind: "meta", text: "Tools selected: Toby (2)" },
		]);
	});
});
