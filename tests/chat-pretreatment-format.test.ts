import { describe, expect, it } from "vitest";
import {
	type UserIntentSpec,
	formatUserMessageWithPretreatment,
} from "../src/ai/pretreatment";
import { mergeUserPromptWithPretreatmentSpec } from "../src/ui/chat/prepare-messages";

function minimalSpec(over: Partial<UserIntentSpec> = {}): UserIntentSpec {
	return {
		goal: "Test goal",
		mustDo: ["a"],
		mustNotDo: [],
		assumptions: [],
		openQuestions: [],
		relevantIntegrations: ["todoist"],
		...over,
	};
}

describe("formatUserMessageWithPretreatment", () => {
	it("returns verbatim only when spec is null", () => {
		expect(formatUserMessageWithPretreatment("  hi there  ", null)).toBe(
			"hi there",
		);
	});

	it("includes JSON-quoted verbatim and structured sections", () => {
		const spec = minimalSpec({
			goal: "List tasks",
			mustDo: ["fetch open tasks"],
			mustNotDo: ["delete anything"],
			assumptions: ["user means Todoist"],
			openQuestions: ["which project?"],
			relevantIntegrations: ["todoist"],
		});
		const out = formatUserMessageWithPretreatment("show my todos", spec);
		expect(out).toContain("User request (verbatim):");
		expect(out).toContain(JSON.stringify("show my todos"));
		expect(out).toContain("Auto-extracted intent (best-effort):");
		expect(out).toContain("- Goal: List tasks");
		expect(out).toContain("Must:");
		expect(out).toContain("fetch open tasks");
		expect(out).toContain("Must not:");
		expect(out).toContain("delete anything");
		expect(out).toContain("Open questions:");
		expect(out).toContain("which project?");
	});

	it("renders empty arrays as (none) bullet groups", () => {
		const spec = minimalSpec({
			mustDo: [],
			mustNotDo: [],
			assumptions: [],
			openQuestions: [],
			relevantIntegrations: [],
		});
		const out = formatUserMessageWithPretreatment("x", spec);
		expect(out).toContain("- Must: (none)");
		expect(out).toContain("- Must not: (none)");
	});

	it("mergeUserPromptWithPretreatmentSpec matches format helper", () => {
		const spec = minimalSpec();
		expect(mergeUserPromptWithPretreatmentSpec("x", spec)).toBe(
			formatUserMessageWithPretreatment("x", spec),
		);
	});
});
