export type SlackConversationMetadata = {
	readonly teamId: string;
	readonly channelId: string;
	readonly threadRootTs: string;
	readonly channelLabel?: string;
};

export type InboundConversation = {
	readonly externalKey: string;
	readonly displayName: string;
	readonly metadata: Record<string, unknown>;
};

export type PluginInboundChatEvent = {
	readonly integration: string;
	readonly externalKey: string;
	readonly messageId: string;
	readonly text: string;
	readonly authorId: string;
	readonly isNewConversationTurn: boolean;
	readonly conversation: InboundConversation;
	readonly botUserId?: string;
};

export function buildSlackExternalKey(
	teamId: string,
	channelId: string,
	threadRootTs: string,
): string {
	return `slack:${teamId}:${channelId}:${threadRootTs}`;
}

export function stripSlackBotMention(text: string, botUserId: string): string {
	const pattern = new RegExp(`<@${botUserId}>`, "gi");
	return text.replace(pattern, "").trim();
}

export type SlackInboundMessageAction =
	| "ignore"
	| "ask_user_reply"
	| "new_turn";

/** Slack IM channel ids start with \`D\` (one DM per user↔bot pair). */
export function isSlackDmChannel(channelId: string): boolean {
	return /^D[A-Z0-9]+$/i.test(channelId.trim());
}

export function resolveSlackThreadRootTs(
	channelId: string,
	messageTs: string,
	threadTs?: string,
): string {
	if (isSlackDmChannel(channelId)) {
		return threadTs ?? channelId;
	}
	return threadTs ?? messageTs;
}

export function slackReplyThreadTs(
	meta: SlackConversationMetadata,
): string | undefined {
	if (
		isSlackDmChannel(meta.channelId) &&
		meta.threadRootTs === meta.channelId
	) {
		return undefined;
	}
	return meta.threadRootTs;
}

export function slackChannelLabel(channelId: string): string {
	return isSlackDmChannel(channelId) ? "DM" : `#${channelId}`;
}

export function classifySlackInboundMessage(params: {
	readonly isDm: boolean;
	readonly hasThreadTs: boolean;
	readonly hasExternalSession: boolean;
	readonly awaitingAskUser: boolean;
}): SlackInboundMessageAction {
	if (params.isDm) {
		if (params.awaitingAskUser) {
			return "ask_user_reply";
		}
		return "new_turn";
	}
	if (!params.hasThreadTs || !params.hasExternalSession) {
		return "ignore";
	}
	if (params.awaitingAskUser) {
		return "ask_user_reply";
	}
	return "new_turn";
}

export function conversationFromMetadata(
	displayName: string,
	metadata: SlackConversationMetadata,
): InboundConversation {
	return {
		externalKey: buildSlackExternalKey(
			metadata.teamId,
			metadata.channelId,
			metadata.threadRootTs,
		),
		displayName,
		metadata: metadata as unknown as Record<string, unknown>,
	};
}

export function metadataFromConversation(
	conversation: InboundConversation,
): SlackConversationMetadata {
	return conversation.metadata as SlackConversationMetadata;
}

export function formatAskUserMessage(
	question: string,
	options: readonly string[],
): string {
	const lines = options.map((o, i) => `${i + 1}) ${o}`);
	return `${question}\n\n${lines.join("\n")}\n\n_Reply with a number, option text, or your answer._`;
}

export function buildInboundPersonaAppendix(
	conversation: InboundConversation,
): string {
	const meta = metadataFromConversation(conversation);
	return `

You are in Slack ${isSlackDmChannel(meta.channelId) ? "DM" : `channel \`${meta.channelId}\``}${isSlackDmChannel(meta.channelId) ? "" : `, thread \`${meta.threadRootTs}\``}.
Your main assistant reply is posted automatically. Use **replyToPost** only for an extra follow-up message (not as a substitute for your normal reply).
`;
}
