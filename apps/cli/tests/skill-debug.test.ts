import { describe, expect, it } from "vitest";
import { getSkillDebugTextLines } from "../src/ui/chat/skill-debug";

describe("getSkillDebugTextLines", () => {
	it("lists available skill names and descriptions", () => {
		const lines = getSkillDebugTextLines({
			available: [
				{
					dirName: "a",
					name: "alpha",
					description: "Does A.",
					bodyMarkdown: "",
				},
			],
			priorMessages: null,
			rawUserText: "hello world first turn",
			isFirstTurn: true,
			spec: {
				goal: "g",
				mustDo: [],
				mustNotDo: [],
				assumptions: [],
				openQuestions: [],
				relevantIntegrations: [],
				relevantSkills: ["alpha"],
			},
		});
		expect(lines[0]).toContain("Local skills available (1)");
		expect(lines[0]).toContain("alpha");
		expect(lines.some((l) => l.includes("Does A."))).toBe(true);
		expect(lines.some((l) => l.includes("skills selected: alpha"))).toBe(true);
	});

	it("reports pretreatment disabled via env", () => {
		const prev = process.env.TOBY_DISABLE_PRETREATMENT;
		process.env.TOBY_DISABLE_PRETREATMENT = "1";
		try {
			const lines = getSkillDebugTextLines({
				available: [],
				priorMessages: null,
				rawUserText: "hello",
				isFirstTurn: true,
				spec: null,
			});
			expect(lines.some((l) => l.includes("TOBY_DISABLE_PRETREATMENT"))).toBe(
				true,
			);
		} finally {
			if (prev === undefined) {
				process.env.TOBY_DISABLE_PRETREATMENT = undefined;
			} else {
				process.env.TOBY_DISABLE_PRETREATMENT = prev;
			}
		}
	});

	it("reports heuristic skip when pretreatment does not run", () => {
		const prev = process.env.TOBY_DISABLE_PRETREATMENT;
		process.env.TOBY_DISABLE_PRETREATMENT = undefined;
		try {
			const lines = getSkillDebugTextLines({
				available: [],
				priorMessages: [{ role: "user", content: "prior" }],
				rawUserText:
					"Inbox summaries must exclude archived promotional threads when listing actionable messages for prioritization workflows.",
				isFirstTurn: false,
				spec: null,
			});
			expect(lines.some((l) => l.includes("heuristic"))).toBe(true);
		} finally {
			if (prev !== undefined) {
				process.env.TOBY_DISABLE_PRETREATMENT = prev;
			}
		}
	});
});
