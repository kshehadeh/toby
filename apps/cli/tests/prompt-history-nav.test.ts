import { describe, expect, it } from "vitest";
import { navigatePromptHistory } from "../src/ui/chat/prompt-history-nav";

const PROMPTS = ["first", "second", "third"];

describe("navigatePromptHistory", () => {
	it("up from empty starts at most recent prompt", () => {
		const result = navigatePromptHistory(
			"up",
			{ browseIndex: -1, draft: "" },
			PROMPTS,
		);
		expect(result).toEqual({
			browseIndex: 2,
			draft: "",
			value: "third",
		});
	});

	it("up again moves to older prompts", () => {
		const result = navigatePromptHistory(
			"up",
			{ browseIndex: 2, draft: "" },
			PROMPTS,
		);
		expect(result?.value).toBe("second");
		expect(result?.browseIndex).toBe(1);
	});

	it("down from oldest restores draft", () => {
		const result = navigatePromptHistory(
			"down",
			{ browseIndex: 2, draft: "" },
			PROMPTS,
		);
		expect(result).toEqual({
			browseIndex: -1,
			draft: "",
			value: "",
		});
	});

	it("down steps toward newer prompts before restoring draft", () => {
		const result = navigatePromptHistory(
			"down",
			{ browseIndex: 0, draft: "draft" },
			PROMPTS,
		);
		expect(result?.browseIndex).toBe(1);
		expect(result?.value).toBe("second");
	});
});
