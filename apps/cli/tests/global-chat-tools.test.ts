import { describe, expect, it } from "bun:test";
import { sanitizeSkillFolderSegment } from "@toby/core/ai/global-chat-tools";

describe("sanitizeSkillFolderSegment", () => {
	it("normalizes to kebab-case", () => {
		expect(sanitizeSkillFolderSegment("  My Cool Skill  ")).toBe(
			"my-cool-skill",
		);
	});

	it("rejects empty or invalid", () => {
		expect(sanitizeSkillFolderSegment("")).toBeNull();
		expect(sanitizeSkillFolderSegment("!!!")).toBeNull();
		expect(sanitizeSkillFolderSegment("..")).toBeNull();
	});
});
