import type { ChatEvent } from "./chat-pipeline/chat-events";

const DEFAULT_PERSONA_DISPLAY_NAME = "Toby";

export function resolvePersonaDisplayName(name: string | undefined): string {
	const trimmed = name?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_PERSONA_DISPLAY_NAME;
}

/** Footer line while waiting on or between main-model steps. */
export function formatListeningToPersona(
	personaName: string | undefined,
): string {
	const name = resolvePersonaDisplayName(personaName);
	return `Listening to what ${name} has to say`;
}

/** Footer line when the main model request has started. */
export function formatChattingWithPersona(
	personaName: string | undefined,
): string {
	const name = resolvePersonaDisplayName(personaName);
	return `Chatting with ${name}`;
}

export function isHiddenLifecycleHeader(header: string): boolean {
	const h = header.trim();
	if (
		h === "Updating session messages…" ||
		h === "Saving session…" ||
		h === "Preparing Session…"
	) {
		return true;
	}
	if (h.startsWith("Chatting with ")) {
		return true;
	}
	return false;
}

export type ActivityLineForChatEventOptions = {
	readonly personaName?: string;
};

/**
 * Human-readable footer line for the bottom activity spinner.
 * Returns null when tool hooks own the line (`formatToolStatusLine`).
 */
export function activityLineForChatEvent(
	ev: ChatEvent,
	options?: ActivityLineForChatEventOptions,
): string | null {
	const listening = formatListeningToPersona(options?.personaName);

	switch (ev.type) {
		case "prep_start": {
			const header = ev.header.trim();
			if (!header) {
				return "Preparing request…";
			}
			return header.endsWith("…") ? header : `${header}…`;
		}
		case "prep_end":
			return "Ready for model…";
		case "lifecycle_start":
			return ev.header;
		case "lifecycle_append":
		case "lifecycle_set":
			return ev.line;
		case "lifecycle_end":
			return ev.detail;
		case "reasoning_start":
			return "Model is thinking…";
		case "reasoning_delta":
			return null;
		case "reasoning_end":
			return listening;
		case "assistant_segment_start":
			return "Receiving response…";
		case "assistant_text_delta":
			return null;
		case "assistant_segment_end":
			return listening;
		case "tool_call_start":
			return null;
		case "tool_call_complete":
			return null;
		case "plan_created":
			return "Plan created…";
		case "plan_phase_start":
			return `Executing phase ${ev.index + 1}/${ev.total}: ${ev.label}`;
		case "plan_phase_end":
			return listening;
		case "plan_amended":
			return "Plan updated…";
		case "plan_completed":
			return ev.status === "completed"
				? "Plan completed."
				: `Plan ${ev.status}.`;
		default:
			return null;
	}
}
