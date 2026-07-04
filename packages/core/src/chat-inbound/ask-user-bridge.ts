import type { AskUserHandler, AskUserToolResult } from "../ai/ask-user-tool";
import { daemonLog } from "../logging/daemon-log";
import { type PendingAskUser, setPendingAskUser } from "../session-store";
import type { ChatInboundProvider, InboundConversation } from "./types";

export function resolveAskUserAnswer(
	raw: string,
	options: readonly string[],
): AskUserToolResult {
	const trimmed = raw.trim();
	const asNum = Number.parseInt(trimmed, 10);
	if (
		trimmed !== "" &&
		!Number.isNaN(asNum) &&
		asNum >= 1 &&
		asNum <= options.length
	) {
		const selectedIndex = asNum - 1;
		return {
			selectedIndex,
			selectedLabel: options[selectedIndex] ?? "",
			rawInput: trimmed,
		};
	}
	const idx = options.findIndex(
		(c) => c.toLowerCase() === trimmed.toLowerCase(),
	);
	if (idx >= 0) {
		return {
			selectedIndex: idx,
			selectedLabel: options[idx] ?? "",
			rawInput: trimmed,
		};
	}
	if (trimmed.length > 0) {
		return {
			selectedIndex: -1,
			selectedLabel: trimmed,
			rawInput: trimmed,
		};
	}
	return {
		selectedIndex: -1,
		selectedLabel: "",
		rawInput: trimmed,
		error:
			"Invalid choice; reply with a number, option text, or free-text answer.",
	};
}

/**
 * Creates the inbound askUser handler. Uses continuation-turn semantics:
 * the question is posted to the remote surface and the tool returns immediately
 * with a "posted, awaiting reply" result. The model turn ends (lifecycle
 * becomes `awaiting_user`). When the user replies on the remote surface, the
 * inbound router starts a new continuation turn with the reply text.
 */
export function createAskUserBridge(params: {
	readonly integration: string;
	readonly provider: ChatInboundProvider;
	readonly conversation: InboundConversation;
	readonly dryRun: boolean;
}): AskUserHandler {
	const { integration, provider, conversation, dryRun } = params;
	return async ({ query, options }) => {
		const pending: PendingAskUser = {
			question: query,
			options,
			createdAt: new Date().toISOString(),
		};
		setPendingAskUser(integration, conversation.externalKey, pending);
		daemonLog("info", "turn", "ask_user_posted", {
			integration,
			externalKey: conversation.externalKey,
			optionCount: options.length,
		});
		await provider.deliverAskUser({
			conversation,
			question: query,
			options,
			dryRun,
		});
		return {
			selectedIndex: -1,
			selectedLabel: "",
			rawInput: "",
			error:
				"Question posted to user. Stop responding and wait for their reply — it will arrive as a new message.",
		} satisfies AskUserToolResult;
	};
}
