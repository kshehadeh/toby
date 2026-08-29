import { describe, expect, it } from "bun:test";
import { buildSelectionTranscriptEntries } from "@toby/core/chat-pipeline/selection-transcript";

describe("selection transcript", () => {
	it("emits every selected tool name for native activity metadata", () => {
		const tools = [
			"askUser",
			"getCurrentDateTime",
			"writeTextFile",
			"memorySearch",
			"searchSlack",
			"readSlackThread",
			"postSlackMessage",
			"webSearch",
			"fetchWebContent",
			"getWeather",
			"getMyLocation",
			"readTranscript",
			"macClipboardRead",
		];

		const entries = buildSelectionTranscriptEntries({
			relevantSkills: [],
			allToolNames: tools,
			toolIntegrationLabels: {},
			relevantTools: tools,
			pretreatmentRan: true,
		});

		expect(entries).toEqual([
			{
				kind: "notice",
				text: `13 tools: ${tools.join(", ")}`,
				tone: "info",
			},
		]);
	});

	it("includes names when the selected set contains only core tools", () => {
		const entries = buildSelectionTranscriptEntries({
			relevantSkills: [],
			allToolNames: ["askUser", "getCurrentDateTime", "writeTextFile"],
			toolIntegrationLabels: {},
			relevantTools: [],
			pretreatmentRan: true,
		});

		expect(entries).toEqual([
			{
				kind: "notice",
				text: "3 core tools: askUser, getCurrentDateTime, writeTextFile",
				tone: "info",
			},
		]);
	});
});
