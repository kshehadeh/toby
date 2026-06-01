import { App } from "@slack/bolt";
import type {
	ChatInboundProvider,
	InboundChatEvent,
	InboundConversation,
} from "../../chat-inbound/types";
import { daemonLog } from "../../logging/daemon-log";
import type { PendingAskUser } from "../../session-store";
import { loadExternalSession } from "../../session-store";
import {
	getSlackInboundCredentials,
	postSlackMessage,
	resolveSlackBotUserId,
	resolveSlackPostToken,
} from "./client";
import { formatSlackInboundStatusMrkdwn } from "./status-format";
import {
	createNoOpStatusReporter,
	createSlackStatusReporter,
} from "./status-reporter";

export type SlackConversationMetadata = {
	readonly teamId: string;
	readonly channelId: string;
	readonly threadRootTs: string;
	readonly channelLabel?: string;
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

/** Slack IM channel ids start with `D` (one DM per user↔bot pair). */
export function isSlackDmChannel(channelId: string): boolean {
	return /^D[A-Z0-9]+$/i.test(channelId.trim());
}

/**
 * Stable session root for inbound routing.
 * DMs use the channel id so every message in that DM shares one Toby session.
 */
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

/** `thread_ts` to pass to chat.postMessage (omit for top-level DM). */
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

/**
 * Channel thread follow-ups need an existing session; DMs with the Toby app
 * are always handled (no @mention required).
 */
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

function conversationFromMetadata(
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

function metadataFromConversation(
	conversation: InboundConversation,
): SlackConversationMetadata {
	const m = conversation.metadata as SlackConversationMetadata;
	return m;
}

function formatAskUserMessage(
	question: string,
	options: readonly string[],
): string {
	const lines = options.map((o, i) => `${i + 1}) ${o}`);
	return `${question}\n\n${lines.join("\n")}\n\n_Reply with a number, option text, or your answer._`;
}

export const slackChatInboundProvider: ChatInboundProvider = {
	async start(ctx) {
		const {
			botToken,
			appToken,
			botUserId: botUserIdHint,
		} = getSlackInboundCredentials();
		const botUserId = await resolveSlackBotUserId(botToken, botUserIdHint);
		if (botUserIdHint?.trim() && botUserIdHint.trim() !== botUserId) {
			daemonLog("warn", "inbound", "slack_bot_user_id_corrected", {
				configuredBotUserId: botUserIdHint.trim(),
				authTestBotUserId: botUserId,
			});
		}

		daemonLog("info", "inbound", "slack_socket_starting", {
			botUserId,
			hasAppToken: Boolean(appToken),
		});

		const app = new App({
			token: botToken,
			appToken,
			socketMode: true,
		});

		const emitMention = async (params: {
			teamId: string;
			channelId: string;
			messageTs: string;
			threadTs: string | undefined;
			text: string;
			userId: string;
			channelLabel: string;
		}) => {
			const threadRootTs = resolveSlackThreadRootTs(
				params.channelId,
				params.messageTs,
				params.threadTs,
			);
			const metadata: SlackConversationMetadata = {
				teamId: params.teamId,
				channelId: params.channelId,
				threadRootTs,
				channelLabel: params.channelLabel,
			};
			const displayName = `Slack ${params.channelLabel}`;
			const conversation = conversationFromMetadata(displayName, metadata);
			const event: InboundChatEvent = {
				integration: "slack",
				externalKey: conversation.externalKey,
				messageId: params.messageTs,
				text: stripSlackBotMention(params.text, botUserId),
				authorId: params.userId,
				isNewConversationTurn: true,
				conversation,
				botUserId,
			};
			if (!event.text.trim()) {
				return;
			}
			daemonLog("info", "inbound", "slack_app_mention", {
				channelId: params.channelId,
				threadRootTs: threadRootTs,
				userId: params.userId,
			});
			ctx.emit(event);
		};

		app.event("app_mention", async ({ event, context }) => {
			if (ctx.signal.aborted) {
				return;
			}
			const teamId = context.teamId ?? "unknown";
			const channelId = event.channel;
			const text = "text" in event && event.text ? event.text : "";
			await emitMention({
				teamId,
				channelId,
				messageTs: event.ts,
				threadTs: "thread_ts" in event ? event.thread_ts : undefined,
				text,
				userId: event.user ?? "",
				channelLabel: slackChannelLabel(channelId),
			});
		});

		app.event("message", async ({ event, context }) => {
			if (ctx.signal.aborted) {
				return;
			}
			if (event.subtype) {
				return;
			}
			if (!("user" in event) || !event.user) {
				return;
			}
			if (event.user === botUserId) {
				return;
			}
			const text = "text" in event && event.text ? event.text : "";
			if (!text.trim()) {
				return;
			}
			const threadTs =
				"thread_ts" in event && event.thread_ts ? event.thread_ts : undefined;
			const teamId = context.teamId ?? "unknown";
			const channelId = event.channel;
			const isDm = isSlackDmChannel(channelId);
			if (!isDm && !threadTs) {
				return;
			}
			const threadRootTs = resolveSlackThreadRootTs(
				channelId,
				event.ts,
				threadTs,
			);
			const externalKey = buildSlackExternalKey(
				teamId,
				channelId,
				threadRootTs,
			);
			const external = loadExternalSession("slack", externalKey);
			const action = classifySlackInboundMessage({
				isDm,
				hasThreadTs: Boolean(threadTs),
				hasExternalSession: Boolean(external),
				awaitingAskUser: Boolean(external?.awaitingAskUser),
			});
			if (action === "ignore") {
				return;
			}
			const label = slackChannelLabel(channelId);
			const metadata: SlackConversationMetadata = {
				teamId,
				channelId,
				threadRootTs,
				channelLabel: label,
			};
			const conversation = conversationFromMetadata(
				external?.displayName ?? `Slack ${label}`,
				metadata,
			);
			const body = isDm ? stripSlackBotMention(text, botUserId) : text.trim();
			if (!body) {
				return;
			}
			if (action === "ask_user_reply") {
				daemonLog(
					"debug",
					"inbound",
					isDm ? "slack_dm_reply" : "slack_thread_reply",
					{
						externalKey,
						userId: event.user,
					},
				);
				ctx.emit({
					integration: "slack",
					externalKey,
					messageId: event.ts,
					text: body,
					authorId: event.user,
					isNewConversationTurn: false,
					conversation,
					botUserId,
				});
				return;
			}
			daemonLog(
				"info",
				"inbound",
				isDm ? "slack_dm_message" : "slack_thread_message",
				{
					externalKey,
					userId: event.user,
				},
			);
			ctx.emit({
				integration: "slack",
				externalKey,
				messageId: event.ts,
				text: body,
				authorId: event.user,
				isNewConversationTurn: true,
				conversation,
				botUserId,
			});
		});

		await app.start();
		daemonLog("info", "inbound", "slack_socket_connected", {
			botUserId,
			message:
				"Socket Mode WebSocket is active; listening for app_mention, DMs, and thread messages",
		});
		if (ctx.signal.aborted) {
			await app.stop();
			daemonLog("info", "inbound", "slack_socket_stopped", {
				reason: "aborted during start",
			});
			return () => {};
		}

		return () => {
			daemonLog("info", "inbound", "slack_socket_stopping", {});
			void app.stop();
		};
	},

	buildInboundPersonaAppendix(conversation) {
		const meta = metadataFromConversation(conversation);
		return `

You are in Slack ${isSlackDmChannel(meta.channelId) ? "DM" : `channel \`${meta.channelId}\``}${isSlackDmChannel(meta.channelId) ? "" : `, thread \`${meta.threadRootTs}\``}.
Your main assistant reply is posted automatically. Use **replyToPost** only for an extra follow-up message (not as a substitute for your normal reply).
`;
	},

	formatInboundStatusLine: formatSlackInboundStatusMrkdwn,

	createStatusReporter({ conversation, dryRun }) {
		if (dryRun) {
			return createNoOpStatusReporter();
		}
		const meta = metadataFromConversation(conversation);
		return createSlackStatusReporter({
			channelId: meta.channelId,
			threadTs: slackReplyThreadTs(meta),
			token: resolveSlackPostToken(),
		});
	},

	async deliverReply({ conversation, text, dryRun }) {
		const meta = metadataFromConversation(conversation);
		if (dryRun) {
			return;
		}
		await postSlackMessage({
			channel: meta.channelId,
			text,
			threadTs: slackReplyThreadTs(meta),
			token: resolveSlackPostToken(),
		});
	},

	async deliverAskUser({ conversation, question, options, dryRun }) {
		const meta = metadataFromConversation(conversation);
		const body = formatAskUserMessage(question, options);
		if (dryRun) {
			return;
		}
		await postSlackMessage({
			channel: meta.channelId,
			text: body,
			threadTs: slackReplyThreadTs(meta),
			token: resolveSlackPostToken(),
		});
	},

	matchesAskUserReply(event, _pending: PendingAskUser) {
		return !event.isNewConversationTurn;
	},
};
