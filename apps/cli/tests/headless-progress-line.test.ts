import { headlessProgressLineForChatEvent } from "@toby/core/chat-pipeline/headless-session";
import { describe, expect, it } from "vitest";

describe("headlessProgressLineForChatEvent", () => {
	it("maps prep events to CLI footer lines", () => {
		expect(
			headlessProgressLineForChatEvent({
				type: "prep_start",
				id: "p1",
				seq: 1,
				header: "Expand",
			}),
		).toBe("Expand…");
	});

	it("maps tool_call_start to tool status lines", () => {
		expect(
			headlessProgressLineForChatEvent({
				type: "tool_call_start",
				blockKey: "t1",
				seq: 2,
				toolName: "askUser",
				args: {},
			}),
		).toBe("Waiting for your choice…");
	});

	it("returns null for assistant_text_delta", () => {
		expect(
			headlessProgressLineForChatEvent({
				type: "assistant_text_delta",
				segmentId: "s1",
				seq: 3,
				delta: "hi",
			}),
		).toBeNull();
	});
});
