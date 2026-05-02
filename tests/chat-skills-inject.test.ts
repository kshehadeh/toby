import { describe, expect, it } from "vitest";
import type { CoreMessage } from "../src/ai/chat";
import {
	SKILL_INSTRUCTIONS_APPENDIX_START,
	injectSkillBodiesIntoFirstSystemMessage,
	stripSkillInstructionsAppendix,
} from "../src/ui/chat/prepare-messages";

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
});

describe("stripSkillInstructionsAppendix", () => {
	it("removes content after the appendix marker", () => {
		const raw = `Hello${SKILL_INSTRUCTIONS_APPENDIX_START}### Skill: x\n\ntail`;
		expect(stripSkillInstructionsAppendix(raw)).toBe("Hello");
	});
});
