import type { ChatEvent } from "@toby/core/chat-pipeline/chat-events";
import { applyChatEvent } from "./chat-event-reducer";
import type { TranscriptEntry } from "./types";

const HIDDEN_LIFECYCLE_HEADERS = new Set([
	"Sending request to model…",
	"Updating session messages…",
	"Saving session…",
	"Preparing Session…",
]);

function isHiddenLifecycleHeader(header: string): boolean {
	return HIDDEN_LIFECYCLE_HEADERS.has(header);
}

/** Whether a pipeline event should be stored in the Ink transcript (not the activity line). */
export function shouldPersistChatEventInTranscript(ev: ChatEvent): boolean {
	if (ev.type === "prep_start" || ev.type === "prep_end") {
		return false;
	}
	if (ev.type === "lifecycle_start" && isHiddenLifecycleHeader(ev.header)) {
		return false;
	}
	if (ev.type === "lifecycle_end") {
		return false;
	}
	if (ev.type === "lifecycle_append" || ev.type === "lifecycle_set") {
		return false;
	}
	if (
		ev.type === "reasoning_start" ||
		ev.type === "reasoning_delta" ||
		ev.type === "reasoning_end"
	) {
		return false;
	}
	if (ev.type === "plan_amended" || ev.type === "plan_completed") {
		return false;
	}
	return true;
}

export function applyPersistedChatEvent(
	entries: readonly TranscriptEntry[],
	event: ChatEvent,
): TranscriptEntry[] {
	if (!shouldPersistChatEventInTranscript(event)) {
		return [...entries];
	}
	return applyChatEvent(entries, event);
}
