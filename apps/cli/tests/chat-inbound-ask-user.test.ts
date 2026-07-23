import { describe, expect, it } from "bun:test";
import { resolveAskUserAnswer } from "@toby/core/chat-inbound/ask-user-bridge";

describe("resolveAskUserAnswer", () => {
	const options = ["Archive", "Keep", "Snooze"];

	it("resolves numeric choice", () => {
		const r = resolveAskUserAnswer("2", options);
		expect(r.selectedIndex).toBe(1);
		expect(r.selectedLabel).toBe("Keep");
	});

	it("resolves label match", () => {
		const r = resolveAskUserAnswer("archive", options);
		expect(r.selectedIndex).toBe(0);
	});

	it("accepts free-text when not matching options", () => {
		const r = resolveAskUserAnswer("something else", options);
		expect(r.selectedLabel).toBe("something else");
	});
});
