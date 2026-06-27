import type { CoreMessage } from "@toby/core/ai/chat";
import {
	SKILL_INSTRUCTIONS_APPENDIX_START,
	injectCurrentDateTimeIntoFirstSystemMessage,
	injectSkillBodiesIntoFirstSystemMessage,
	stripSkillInstructionsAppendix,
} from "@toby/core/prepare-messages";
import { describe, expect, it } from "bun:test";

describe("injectSkillBodiesIntoFirstSystemMessage", () => {
	it("appends skill bodies to the first system message", () => {
		const messages: CoreMessage[] = [
			{ role: "system", content: "Base system." },
			{ role: "user", content: "Hi" },
		];
		const skills = [
			{
				dirName: "s1",
				name: "skill-one",
				description: "d",
				bodyMarkdown: "### Do\n\nStep **one**.",
			},
		];
		const out = injectSkillBodiesIntoFirstSystemMessage(
			messages,
			["skill-one"],
			skills,
		);
		const sys = out[0];
		expect(sys?.role).toBe("system");
		expect(typeof sys?.content).toBe("string");
		const c = sys?.content as string;
		expect(c.startsWith("Base system.")).toBe(true);
		expect(c).toContain(SKILL_INSTRUCTIONS_APPENDIX_START);
		expect(c).toContain("### Skill: skill-one");
		expect(c).toContain("Step **one**.");
	});

	it("replaces a prior appendix on the next injection", () => {
		const messages: CoreMessage[] = [
			{
				role: "system",
				content: `Base.${SKILL_INSTRUCTIONS_APPENDIX_START}### Skill: old\n\nold body`,
			},
			{ role: "user", content: "x" },
		];
		const skills = [
			{
				dirName: "n",
				name: "new-skill",
				description: "d",
				bodyMarkdown: "new body",
			},
		];
		const out = injectSkillBodiesIntoFirstSystemMessage(
			messages,
			["new-skill"],
			skills,
		);
		const c = out[0]?.content as string;
		expect(c).toContain("new body");
		expect(c).not.toContain("old body");
		expect((c.match(/Attached skill instructions/g) ?? []).length).toBe(1);
	});

	it("returns unchanged messages when no skills resolve", () => {
		const messages: CoreMessage[] = [
			{ role: "system", content: "S" },
			{ role: "user", content: "u" },
		];
		const out = injectSkillBodiesIntoFirstSystemMessage(
			messages,
			["missing"],
			[],
		);
		expect(out).toEqual(messages);
	});

	it("removes a prior appendix when no skills resolve", () => {
		const messages: CoreMessage[] = [
			{
				role: "system",
				content: `Base.${SKILL_INSTRUCTIONS_APPENDIX_START}### Skill: old\n\nold body`,
			},
			{ role: "user", content: "u" },
		];
		const out = injectSkillBodiesIntoFirstSystemMessage(messages, [], []);
		expect(out[0]?.content).toBe("Base.");
		expect((out[0]?.content as string).includes("old body")).toBe(false);
	});
});

describe("stripSkillInstructionsAppendix", () => {
	it("removes content after the appendix marker", () => {
		const raw = `Hello${SKILL_INSTRUCTIONS_APPENDIX_START}### Skill: x\n\ntail`;
		expect(stripSkillInstructionsAppendix(raw)).toBe("Hello");
	});
});

describe("injectCurrentDateTimeIntoFirstSystemMessage", () => {
	it("adds current datetime as a separate system message after the first", () => {
		const messages: CoreMessage[] = [
			{ role: "system", content: "Base system." },
			{ role: "user", content: "Hi" },
		];
		const out = injectCurrentDateTimeIntoFirstSystemMessage(messages);
		// First system message should not contain datetime anymore.
		expect(out[0]?.role).toBe("system");
		expect(out[0]?.content as string).toBe("Base system.");
		// Second message should be the datetime system message.
		expect(out[1]?.role).toBe("system");
		const datetimeContent = out[1]?.content as string;
		expect(datetimeContent).toContain("## Current date and time");
		expect(datetimeContent).toContain("Local datetime:");
		expect(datetimeContent).toContain("Timezone:");
		expect(datetimeContent).toContain("UTC datetime:");
		expect(datetimeContent).toContain("Unix ms:");
		// Third message should be the user message.
		expect(out[2]?.role).toBe("user");
	});

	it("replaces prior datetime system message instead of duplicating it", () => {
		const messages: CoreMessage[] = [
			{ role: "system", content: "Base system." },
			{ role: "user", content: "Hi" },
		];
		const first = injectCurrentDateTimeIntoFirstSystemMessage(messages);
		const second = injectCurrentDateTimeIntoFirstSystemMessage(first);
		// Count datetime system messages (should be exactly 1).
		const datetimeCount = second.filter(
			(m) =>
				m.role === "system" &&
				typeof m.content === "string" &&
				m.content.includes("## Current date and time"),
		).length;
		expect(datetimeCount).toBe(1);
	});
});
