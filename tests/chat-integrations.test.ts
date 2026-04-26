import { describe, expect, it } from "vitest";
import { parseChatCliInput } from "../src/commands/chat-integrations";

describe("parseChatCliInput", () => {
	it("defaults to all connected when no flags and no words", () => {
		expect(parseChatCliInput([], [])).toEqual({
			explicitNames: null,
			prompt: "",
		});
	});

	it("uses all connected when first word is not an integration", () => {
		expect(parseChatCliInput(["hello", "world"], [])).toEqual({
			explicitNames: null,
			prompt: "hello world",
		});
	});

	it("peels gmail as integration and rest as prompt", () => {
		expect(parseChatCliInput(["gmail", "archive", "spam"], [])).toEqual({
			explicitNames: ["gmail"],
			prompt: "archive spam",
		});
	});

	it("peels todoist as integration", () => {
		expect(parseChatCliInput(["todoist"], [])).toEqual({
			explicitNames: ["todoist"],
			prompt: "",
		});
	});

	it("treats all positional as prompt when flags set", () => {
		expect(parseChatCliInput(["gmail", "hello"], ["todoist", "gmail"])).toEqual(
			{
				explicitNames: ["todoist", "gmail"],
				prompt: "gmail hello",
			},
		);
	});

	it("dedupes integration flags case-insensitively", () => {
		expect(parseChatCliInput([], ["Gmail", "gmail", "todoist"])).toEqual({
			explicitNames: ["gmail", "todoist"],
			prompt: "",
		});
	});
});
