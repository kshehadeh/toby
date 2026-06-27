import "./helpers/setup-mocks";
import {
	type UserIntentSpec,
	formatUserMessageWithPretreatment,
} from "@toby/core/ai/pretreatment";
import { mergeUserPromptWithPretreatmentSpec } from "@toby/core/prepare-messages";
import { describe, expect, it } from "bun:test";

function minimalSpec(over: Partial<UserIntentSpec> = {}): UserIntentSpec {
	return {
		goal: "Test goal",
		mustDo: ["a"],
		mustNotDo: [],
		assumptions: [],
		openQuestions: [],
		relevantIntegrations: ["todoist"],
		relevantSkills: [],
		relevantTools: [],
		sessionName: "",
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
			relevantSkills: [],
			relevantTools: [],
		});
		const out = formatUserMessageWithPretreatment("x", spec);
		expect(out).toContain("- Must: (none)");
		expect(out).toContain("- Must not: (none)");
		expect(out).toContain("- Selected skills: (none)");
		expect(out).toContain("- Selected tools: (none)");
	});

	it("includes selected skills with descriptions when catalog is provided", () => {
		const spec = minimalSpec({
			relevantSkills: ["my-skill"],
		});
		const out = formatUserMessageWithPretreatment("do it", spec, [
			{
				dirName: "my-skill",
				name: "my-skill",
				description: "When testing.",
				bodyMarkdown: "# Body",
			},
		]);
		expect(out).toContain("Selected skills:");
		expect(out).toContain("my-skill: When testing.");
	});

	it("includes selected tools in formatted output", () => {
		const spec = minimalSpec({
			relevantTools: ["fetchOpenTasks", "listProjectNames"],
		});
		const out = formatUserMessageWithPretreatment("show tasks", spec);
		expect(out).toContain("Selected tools:");
		expect(out).toContain("fetchOpenTasks");
		expect(out).toContain("listProjectNames");
	});

	it("includes session name in formatted output", () => {
		const spec = minimalSpec({ sessionName: "Inbox Triage" });
		const out = formatUserMessageWithPretreatment("triage my inbox", spec);
		expect(out).toContain("- Session name: Inbox Triage");
	});

	it("mergeUserPromptWithPretreatmentSpec matches format helper", () => {
		const spec = minimalSpec();
		expect(mergeUserPromptWithPretreatmentSpec("x", spec)).toBe(
			formatUserMessageWithPretreatment("x", spec),
		);
	});
});
