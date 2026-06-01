import type { AskUserHandler, AskUserToolResult } from "../ai/ask-user-tool";
import { daemonLog } from "../logging/daemon-log";
import {
	type PendingAskUser,
	clearPendingAskUser,
	setPendingAskUser,
} from "../ui/chat/session-store";
import type { ChatInboundProvider, InboundConversation } from "./types";

type PendingResolver = {
	readonly resolve: (result: AskUserToolResult) => void;
};

const pendingResolvers = new Map<string, PendingResolver>();

function resolverKey(integration: string, externalKey: string): string {
	return `${integration}:${externalKey}`;
}

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

export function tryResolvePendingAskUser(
	integration: string,
	externalKey: string,
	rawText: string,
	options: readonly string[],
): boolean {
	const key = resolverKey(integration, externalKey);
	const pending = pendingResolvers.get(key);
	if (!pending) {
		return false;
	}
	pendingResolvers.delete(key);
	clearPendingAskUser(integration, externalKey);
	pending.resolve(resolveAskUserAnswer(rawText, options));
	return true;
}

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
		return await new Promise<AskUserToolResult>((resolve) => {
			pendingResolvers.set(resolverKey(integration, conversation.externalKey), {
				resolve,
			});
		});
	};
}
