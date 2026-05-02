import { describe, expect, it } from "vitest";
import { inferRelevantSkillsFromUserPrompt } from "../src/skills/index";

const gmailSkill = {
	dirName: "check-unread-emails-summarize",
	name: "check-unread-emails-summarize",
	description:
		"Fetch unread messages from the user's Gmail and return a compact summary.",
	bodyMarkdown: "",
};

describe("inferRelevantSkillsFromUserPrompt", () => {
	it("matches summarize / unread / emails style prompts to a kebab-named Gmail skill", () => {
		const picked = inferRelevantSkillsFromUserPrompt(
			"Can you summarize my unread emails?",
			[gmailSkill],
		);
		expect(picked).toEqual(["check-unread-emails-summarize"]);
	});

	it("returns empty when no skill token overlap", () => {
		const picked = inferRelevantSkillsFromUserPrompt(
			"What is the capital of France?",
			[gmailSkill],
		);
		expect(picked).toEqual([]);
	});

	it("returns empty when two top skills tie with one overlapping token each", () => {
		const a = {
			dirName: "a",
			name: "foo-only-skill",
			description: "Does foo things.",
			bodyMarkdown: "",
		};
		const b = {
			dirName: "b",
			name: "bar-only-skill",
			description: "Does bar things.",
			bodyMarkdown: "",
		};
		const picked = inferRelevantSkillsFromUserPrompt(
			"Tell me about foo and bar",
			[a, b],
		);
		expect(picked).toEqual([]);
	});
});
