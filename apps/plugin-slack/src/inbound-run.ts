import { App } from "@slack/bolt";
import {
	getSlackInboundCredentials,
	postSlackMessage,
	resolveSlackBotUserId,
	resolveSlackPostToken,
} from "./client";
import {
	type InboundConversation,
	type PluginInboundChatEvent,
	type SlackConversationMetadata,
	buildInboundPersonaAppendix,
	buildSlackExternalKey,
	classifySlackInboundMessage,
	conversationFromMetadata,
	formatAskUserMessage,
	isSlackDmChannel,
	metadataFromConversation,
	resolveSlackThreadRootTs,
	slackChannelLabel,
	slackReplyThreadTs,
	stripSlackBotMention,
} from "./inbound-logic";
import { emitInboundLine, readStdinLines } from "./protocol";
import {
	type InboundStatusReporter,
	createNoOpStatusReporter,
	createSlackStatusReporter,
} from "./status-reporter";

type JsonRecord = Record<string, unknown>;

/** Plugin → core messages on stdout during \`inbound run\`. */
export type PluginInboundToCoreMessage =
	| { readonly type: "ready" }
	| { readonly type: "event"; readonly event: PluginInboundChatEvent }
	| {
			readonly type: "personaAppendix";
			readonly requestId: string;
			readonly text: string;
	  }
	| { readonly type: "error"; readonly message: string };

/** Core → plugin messages on stdin during \`inbound run\`. */
export type PluginInboundFromCoreMessage =
	| {
			readonly type: "start";
			readonly config: Record<string, unknown>;
			readonly state: Record<string, unknown>;
			readonly dryRun: boolean;
			readonly externalSessions?: readonly {
				readonly externalKey: string;
				readonly sessionId: string;
				readonly displayName: string | null;
				readonly metadata: Record<string, unknown>;
				readonly awaitingAskUser: {
					readonly question: string;
					readonly options: readonly string[];
					readonly createdAt: string;
				} | null;
				readonly lastProcessedMessageId: string | null;
			}[];
	  }
	| { readonly type: "config"; readonly config: Record<string, unknown> }
	| {
			readonly type: "deliverReply";
			readonly conversation: InboundConversation;
			readonly text: string;
			readonly dryRun: boolean;
	  }
	| {
			readonly type: "deliverAskUser";
			readonly conversation: InboundConversation;
			readonly question: string;
			readonly options: readonly string[];
			readonly dryRun: boolean;
	  }
	| {
			readonly type: "statusUpdate";
			readonly conversation: InboundConversation;
			readonly line: string;
	  }
	| {
			readonly type: "statusClear";
			readonly conversation: InboundConversation;
	  }
	| {
			readonly type: "getPersonaAppendix";
			readonly requestId: string;
			readonly conversation: InboundConversation;
	  }
	| { readonly type: "shutdown" };

function logStderr(message: string): void {
	process.stderr.write(`${message}\n`);
}

function emitToCore(message: PluginInboundToCoreMessage): void {
	emitInboundLine(message as JsonRecord);
}

export async function runInbound(): Promise<void> {
	let config: JsonRecord = {};
	let dryRun = false;
	let botUserId = "";
	let app: App | null = null;
	let shuttingDown = false;

	const knownSessions = new Set<string>();
	const awaitingAskUser = new Set<string>();
	const statusReporters = new Map<string, InboundStatusReporter>();

	const getStatusReporter = (
		conversation: InboundConversation,
	): InboundStatusReporter => {
		if (dryRun) {
			return createNoOpStatusReporter();
		}
		const key = conversation.externalKey;
		let reporter = statusReporters.get(key);
		if (!reporter) {
			const meta = metadataFromConversation(conversation);
			reporter = createSlackStatusReporter({
				config,
				channelId: meta.channelId,
				threadTs: slackReplyThreadTs(meta),
				token: resolveSlackPostToken(config),
			});
			statusReporters.set(key, reporter);
		}
		return reporter;
	};

	const emitEvent = (event: PluginInboundChatEvent): void => {
		knownSessions.add(event.externalKey);
		emitToCore({ type: "event", event });
	};

	const startSocketMode = async (): Promise<void> => {
		const {
			botToken,
			appToken,
			botUserId: botUserIdHint,
		} = getSlackInboundCredentials(config);
		botUserId = await resolveSlackBotUserId(config, botToken, botUserIdHint);
		if (botUserIdHint?.trim() && botUserIdHint.trim() !== botUserId) {
			logStderr(
				`Slack bot user id corrected: configured=${botUserIdHint.trim()} auth.test=${botUserId}`,
			);
		}

		logStderr("Starting Slack Socket Mode inbound transport...");

		app = new App({
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
			const event: PluginInboundChatEvent = {
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
			emitEvent(event);
		};

		app.event("app_mention", async ({ event, context }) => {
			if (shuttingDown) return;
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
			if (shuttingDown) return;
			if (event.subtype) return;
			if (!("user" in event) || !event.user) return;
			if (event.user === botUserId) return;
			const text = "text" in event && event.text ? event.text : "";
			if (!text.trim()) return;

			const threadTs =
				"thread_ts" in event && event.thread_ts ? event.thread_ts : undefined;
			const teamId = context.teamId ?? "unknown";
			const channelId = event.channel;
			const isDm = isSlackDmChannel(channelId);
			if (!isDm && !threadTs) return;

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
			const action = classifySlackInboundMessage({
				isDm,
				hasThreadTs: Boolean(threadTs),
				hasExternalSession: knownSessions.has(externalKey),
				awaitingAskUser: awaitingAskUser.has(externalKey),
			});
			if (action === "ignore") return;

			const label = slackChannelLabel(channelId);
			const metadata: SlackConversationMetadata = {
				teamId,
				channelId,
				threadRootTs,
				channelLabel: label,
			};
			const conversation = conversationFromMetadata(`Slack ${label}`, metadata);
			const body = isDm ? stripSlackBotMention(text, botUserId) : text.trim();
			if (!body) return;

			emitEvent({
				integration: "slack",
				externalKey,
				messageId: event.ts,
				text: body,
				authorId: event.user,
				isNewConversationTurn: action === "new_turn",
				conversation,
				botUserId,
			});
		});

		await app.start();
		logStderr(
			"Slack Socket Mode connected; listening for app_mention, DMs, and thread messages",
		);
		emitToCore({ type: "ready" });
	};

	const stopSocketMode = async (): Promise<void> => {
		if (app) {
			await app.stop();
			app = null;
		}
	};

	for await (const line of readStdinLines()) {
		let message: PluginInboundFromCoreMessage;
		try {
			message = JSON.parse(line) as PluginInboundFromCoreMessage;
		} catch {
			logStderr(`Ignoring invalid inbound stdin line: ${line.slice(0, 200)}`);
			continue;
		}

		if (message.type === "start") {
			config = { ...message.config };
			dryRun = message.dryRun;
			if (message.externalSessions) {
				for (const session of message.externalSessions) {
					knownSessions.add(session.externalKey);
					if (session.awaitingAskUser) {
						awaitingAskUser.add(session.externalKey);
					}
				}
				logStderr(
					`Seeded ${message.externalSessions.length} persisted Slack session(s) (${awaitingAskUser.size} awaiting askUser).`,
				);
			}
			try {
				await startSocketMode();
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				emitToCore({ type: "error", message: msg });
				process.exit(1);
			}
			continue;
		}

		if (message.type === "config") {
			config = { ...config, ...message.config };
			continue;
		}

		if (message.type === "shutdown") {
			shuttingDown = true;
			for (const reporter of statusReporters.values()) {
				await reporter.clear();
			}
			statusReporters.clear();
			await stopSocketMode();
			process.exit(0);
		}

		if (message.type === "deliverReply") {
			const meta = metadataFromConversation(message.conversation);
			awaitingAskUser.delete(message.conversation.externalKey);
			if (!message.dryRun) {
				await postSlackMessage({
					config,
					channel: meta.channelId,
					text: message.text,
					threadTs: slackReplyThreadTs(meta),
					token: resolveSlackPostToken(config),
				});
			}
			continue;
		}

		if (message.type === "deliverAskUser") {
			const meta = metadataFromConversation(message.conversation);
			awaitingAskUser.add(message.conversation.externalKey);
			const body = formatAskUserMessage(message.question, message.options);
			if (!message.dryRun) {
				await postSlackMessage({
					config,
					channel: meta.channelId,
					text: body,
					threadTs: slackReplyThreadTs(meta),
					token: resolveSlackPostToken(config),
				});
			}
			continue;
		}

		if (message.type === "statusUpdate") {
			getStatusReporter(message.conversation).update(message.line);
			continue;
		}

		if (message.type === "statusClear") {
			const reporter = statusReporters.get(message.conversation.externalKey);
			if (reporter) {
				await reporter.clear();
				statusReporters.delete(message.conversation.externalKey);
			}
			continue;
		}

		if (message.type === "getPersonaAppendix") {
			emitToCore({
				type: "personaAppendix",
				requestId: message.requestId,
				text: buildInboundPersonaAppendix(message.conversation),
			});
		}
	}
}
