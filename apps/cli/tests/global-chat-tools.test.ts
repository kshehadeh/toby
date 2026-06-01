import { sanitizeSkillFolderSegment } from "@toby/core/ai/global-chat-tools";
import { describe, expect, it } from "vitest";

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
