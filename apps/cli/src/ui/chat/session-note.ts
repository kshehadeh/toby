import type {
	NoticeTone,
	TranscriptEntry,
} from "@toby/core/chat-pipeline/transcript-types";
import { logSessionNote } from "@toby/core/logging/chat-log";

export function recordSessionNote(
	sessionId: string | null | undefined,
	text: string,
	extra?: Record<string, unknown>,
): void {
	if (extra === undefined) {
		logSessionNote(sessionId, text);
		return;
	}
	logSessionNote(sessionId, text, extra);
}

export function buildSessionNoticeEntry(
	text: string,
	tone?: NoticeTone,
): Extract<TranscriptEntry, { kind: "notice" }> {
	return tone !== undefined
		? { kind: "notice", text, tone }
		: { kind: "notice", text };
}
