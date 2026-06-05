import type { ChatEvent } from "../../chat-pipeline/chat-events";
import { headlessProgressLineForChatEvent } from "../../chat-pipeline/headless-session";

/** Plain-text fallback for Slack notifications (no mrkdwn). */
export function slackStatusPlainFallback(mrkdwnLine: string): string {
	return mrkdwnLine
		.replace(/\\_/g, "_")
		.replace(/_/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.trim();
}

function escapeSlackMrkdwnItalic(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/_/g, "\\_");
}

/** CLI footer lines → emoji (when event type alone is ambiguous). */
const KNOWN_PROGRESS_LINE_EMOJI: Readonly<Record<string, string>> = {
	"Preparing request…": "⏳",
	"Prompt preparation…": "⏳",
	"Ready for model…": "✨",
	"Receiving response…": "💬",
	"Waiting for your choice…": "❓",
	"Plan created…": "📋",
	"Plan updated…": "✏️",
	"Plan completed.": "✅",
};

function toolStatusEmoji(toolName: string): string {
	if (toolName === "askUser") {
		return "❓";
	}
	const lower = toolName.toLowerCase();
	if (
		lower.includes("email") ||
		lower.includes("mail") ||
		lower.includes("inbox") ||
		lower.includes("gmail")
	) {
		return "📧";
	}
	if (lower.includes("calendar") || lower.includes("event")) {
		return "📅";
	}
	if (lower.includes("todoist") || lower.includes("task")) {
		return "✅";
	}
	if (lower.includes("memory")) {
		return "🧠";
	}
	if (
		lower.includes("slack") ||
		lower.includes("post") ||
		lower.includes("reply")
	) {
		return "💬";
	}
	if (lower.includes("plan")) {
		return "📋";
	}
	if (lower.includes("search") || lower.includes("find")) {
		return "🔍";
	}
	if (lower.includes("user") || lower.includes("azure")) {
		return "👤";
	}
	if (lower.includes("wifi") || lower.includes("network")) {
		return "📶";
	}
	if (lower.includes("skill")) {
		return "📚";
	}
	return "🔧";
}

function integrationLabelEmoji(label: string): string | null {
	const lower = label.toLowerCase();
	if (lower.includes("gmail") || lower.includes("mail")) {
		return "📧";
	}
	if (lower.includes("todoist")) {
		return "✅";
	}
	if (lower.includes("slack")) {
		return "💬";
	}
	if (lower.includes("calendar")) {
		return "📅";
	}
	if (lower.includes("memory")) {
		return "🧠";
	}
	if (lower.includes("azure")) {
		return "👤";
	}
	return null;
}

function lifecycleStatusEmoji(headerOrLine: string): string {
	const lower = headerOrLine.toLowerCase();
	if (lower.includes("chatting with") || lower.includes("model")) {
		return "🤖";
	}
	if (lower.includes("save") || lower.includes("persist")) {
		return "💾";
	}
	if (lower.includes("integration") || lower.includes("context")) {
		return "🔌";
	}
	if (lower.includes("boot") || lower.includes("start")) {
		return "🚀";
	}
	if (lower.includes("expand") || lower.includes("prep")) {
		return "⏳";
	}
	return "⚙️";
}

function emojiForProgressLine(line: string, event: ChatEvent): string {
	const known = KNOWN_PROGRESS_LINE_EMOJI[line];
	if (known) {
		return known;
	}
	if (line.startsWith("Listening to what ")) {
		return "🧠";
	}
	if (line.startsWith("Chatting with ")) {
		return "🤖";
	}
	if (line.startsWith("Executing phase")) {
		return "🚀";
	}
	if (line.startsWith("Calling ")) {
		if (event.type === "tool_call_start") {
			if (event.integrationLabel) {
				const fromLabel = integrationLabelEmoji(event.integrationLabel);
				if (fromLabel) {
					return fromLabel;
				}
			}
			return toolStatusEmoji(event.toolName);
		}
		return "🔧";
	}
	if (line.startsWith("Plan ")) {
		return "📋";
	}
	return slackStatusEmojiForChatEvent(event);
}

export function slackStatusEmojiForChatEvent(event: ChatEvent): string {
	switch (event.type) {
		case "prep_start":
			return "⏳";
		case "prep_end":
			return "✨";
		case "lifecycle_start":
			return lifecycleStatusEmoji(event.header);
		case "lifecycle_append":
		case "lifecycle_set":
			return lifecycleStatusEmoji(event.line);
		case "lifecycle_end":
			return lifecycleStatusEmoji(event.detail);
		case "assistant_segment_start":
			return "💬";
		case "assistant_segment_end":
			return "🧠";
		case "tool_call_start":
			if (event.integrationLabel) {
				const fromLabel = integrationLabelEmoji(event.integrationLabel);
				if (fromLabel) {
					return fromLabel;
				}
			}
			return toolStatusEmoji(event.toolName);
		case "plan_created":
			return "📋";
		case "plan_phase_start":
			return "🚀";
		case "plan_phase_end":
			return "🧠";
		case "plan_amended":
			return "✏️";
		case "plan_completed":
			return event.status === "completed" ? "✅" : "📋";
		default:
			return "⏳";
	}
}

/**
 * Slack status line: emoji + italic mrkdwn inside a context block (dimmed UI).
 */
export function formatSlackInboundStatusMrkdwn(
	event: ChatEvent,
): string | null {
	const line = headlessProgressLineForChatEvent(event);
	if (!line) {
		return null;
	}
	const emoji = emojiForProgressLine(line, event);
	const escaped = escapeSlackMrkdwnItalic(line);
	return `${emoji} _${escaped}_`;
}
