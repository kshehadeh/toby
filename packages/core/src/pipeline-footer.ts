import type { ChatEvent } from "./chat-pipeline/chat-events";

/**
 * Human-readable footer line for the bottom activity spinner.
 * Returns null when tool hooks own the line (`formatToolStatusLine`).
 */
export function activityLineForChatEvent(ev: ChatEvent): string | null {
	switch (ev.type) {
		case "prep_start":
			return "Preparing request…";
		case "prep_end":
			return "Ready for model…";
		case "lifecycle_start":
			return ev.header;
		case "lifecycle_append":
		case "lifecycle_set":
			return ev.line;
		case "lifecycle_end":
			return ev.detail;
		case "assistant_segment_start":
			return "Receiving response…";
		case "assistant_text_delta":
			return null;
		case "assistant_segment_end":
			return "Thinking…";
		case "tool_call_start":
			return null;
		case "tool_call_complete":
			return null;
		case "plan_created":
			return "Plan created…";
		case "plan_phase_start":
			return `Executing phase ${ev.index + 1}/${ev.total}: ${ev.label}`;
		case "plan_phase_end":
			return "Thinking…";
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
