import type { CoreMessage } from "@toby/core/ai/chat";

function userTextInMessages(
	messages: readonly CoreMessage[],
	text: string,
): boolean {
	const trimmed = text.trim();
	if (!trimmed) {
		return false;
	}
	for (const message of messages) {
		if (message.role !== "user") {
			continue;
		}
		if (
			typeof message.content === "string" &&
			message.content.trim() === trimmed
		) {
			return true;
		}
	}
	return false;
}

/**
 * When a turn is steered during pretreatment, the abandoned user prompt may
 * exist in the transcript but not yet in `messages`. Merge it before running
 * the steering prep pipeline so the model sees both prompts.
 */
export function priorMessagesForSteeringTurn(
	priorMessages: readonly CoreMessage[],
	inFlightUserPrompt: string | null | undefined,
): CoreMessage[] {
	const inFlight = inFlightUserPrompt?.trim();
	if (!inFlight || userTextInMessages(priorMessages, inFlight)) {
		return [...priorMessages];
	}
	return [...priorMessages, { role: "user", content: inFlight }];
}

/** Whether the steering prep pipeline should treat this as a first user turn. */
export function isFirstSteeringTurn(priorMessages: readonly CoreMessage[]): boolean {
	return !priorMessages.some((message) => message.role === "user");
}

/** Last user message text in assembled history, if any. */
export function lastUserMessageText(
	messages: readonly CoreMessage[],
): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role === "user" && typeof message.content === "string") {
			const text = message.content.trim();
			if (text.length > 0) {
				return text;
			}
		}
	}
	return null;
}
