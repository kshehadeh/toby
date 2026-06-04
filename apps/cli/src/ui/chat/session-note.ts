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
