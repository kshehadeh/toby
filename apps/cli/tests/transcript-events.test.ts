import type { ChatEvent } from "@toby/core/chat-pipeline/chat-events";
import { describe, expect, it } from "bun:test";
import {
	applyPersistedChatEvent,
	shouldPersistChatEventInTranscript,
} from "../src/ui/chat/transcript-events";

describe("shouldPersistChatEventInTranscript", () => {
	it("skips prep events", () => {
		expect(
			shouldPersistChatEventInTranscript({
				type: "prep_start",
				id: "p1",
				seq: 1,
				header: "Prompt preparation",
			} satisfies ChatEvent),
		).toBe(false);
		expect(
			shouldPersistChatEventInTranscript({
				type: "prep_end",
				id: "p1",
				seq: 2,
				detail: "Ready.",
			} satisfies ChatEvent),
		).toBe(false);
	});

	it("skips hidden lifecycle headers and lifecycle updates", () => {
		expect(
			shouldPersistChatEventInTranscript({
				type: "lifecycle_start",
				id: "l1",
				seq: 1,
				header: "Preparing Session…",
			} satisfies ChatEvent),
		).toBe(false);
		expect(
			shouldPersistChatEventInTranscript({
				type: "lifecycle_set",
				id: "l1",
				seq: 2,
				line: "Loading…",
			} satisfies ChatEvent),
		).toBe(false);
	});

	it("allows tool_call_start", () => {
		expect(
			shouldPersistChatEventInTranscript({
				type: "tool_call_start",
				blockKey: "t1",
				seq: 1,
				toolName: "listLabels",
				args: {},
			} satisfies ChatEvent),
		).toBe(true);
	});
});

describe("applyPersistedChatEvent", () => {
	it("does not add prep rows", () => {
		const next = applyPersistedChatEvent([], {
			type: "prep_start",
			id: "p1",
			seq: 1,
			header: "Prompt preparation",
		} satisfies ChatEvent);
		expect(next).toHaveLength(0);
	});
});
