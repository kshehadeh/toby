import { runHeadlessChatTurn } from "../chat-pipeline/headless-session";
import type { IntegrationModule } from "../integrations/types";
import { daemonLog } from "../logging/daemon-log";
import {
	getOrCreateExternalSession,
	loadExternalSession,
	markMessageProcessed,
	wasMessageProcessed,
} from "../ui/chat/session-store";
import {
	createAskUserBridge,
	tryResolvePendingAskUser,
} from "./ask-user-bridge";
import { withConversationMutex } from "./mutex";
import { setChatInboundStatus } from "./status";
import type { ActiveChatInbound, InboundChatEvent } from "./types";

function matchesDefaultAskUserReply(
	event: InboundChatEvent,
	hasPending: boolean,
): boolean {
	return hasPending && !event.isNewConversationTurn;
}

export async function handleInboundEvent(
	active: ActiveChatInbound,
	event: InboundChatEvent,
): Promise<void> {
	const provider = active.module.chatInbound;
	if (!provider) {
		return;
	}

	if (event.botUserId && event.authorId === event.botUserId) {
		daemonLog("debug", "inbound", "inbound_ignored_bot_author", {
			integration: event.integration,
			externalKey: event.externalKey,
			messageId: event.messageId,
		});
		return;
	}

	if (
		wasMessageProcessed(event.integration, event.externalKey, event.messageId)
	) {
		daemonLog("debug", "inbound", "inbound_duplicate", {
			integration: event.integration,
			messageId: event.messageId,
		});
		return;
	}

	const external = loadExternalSession(event.integration, event.externalKey);
	const hasPending = Boolean(external?.awaitingAskUser);

	if (hasPending && external?.awaitingAskUser) {
		const pending = external.awaitingAskUser;
		const matches =
			provider.matchesAskUserReply?.(event, pending) ??
			matchesDefaultAskUserReply(event, true);
		if (matches) {
			const options = pending.options;
			const resolved = tryResolvePendingAskUser(
				event.integration,
				event.externalKey,
				event.text,
				options,
			);
			if (resolved) {
				daemonLog("info", "inbound", "ask_user_resolved", {
					integration: event.integration,
					externalKey: event.externalKey,
				});
				markMessageProcessed(
					event.integration,
					event.externalKey,
					event.messageId,
				);
			}
			return;
		}
	}

	if (!event.isNewConversationTurn) {
		return;
	}

	const mutexKey = `${event.integration}:${event.externalKey}`;
	await withConversationMutex(mutexKey, async () => {
		if (
			wasMessageProcessed(event.integration, event.externalKey, event.messageId)
		) {
			return;
		}

		const record = getOrCreateExternalSession({
			integration: event.integration,
			externalKey: event.externalKey,
			displayName: event.conversation.displayName,
			metadata: event.conversation.metadata,
		});

		daemonLog("info", "turn", "turn_start", {
			integration: event.integration,
			externalKey: event.externalKey,
			sessionId: record.sessionId,
			messageId: event.messageId,
			promptPreview: event.text.slice(0, 120),
		});

		const askUser = createAskUserBridge({
			integration: event.integration,
			provider,
			conversation: {
				externalKey: event.externalKey,
				displayName: record.displayName ?? event.conversation.displayName,
				metadata: record.metadata,
			},
			dryRun: active.dryRun,
		});

		const statusReporter = provider.createStatusReporter?.({
			conversation: event.conversation,
			dryRun: active.dryRun,
		});

		try {
			const turn = await runHeadlessChatTurn({
				inboundModule: active.module,
				sessionId: record.sessionId,
				userText: event.text,
				persona: active.persona,
				dryRun: active.dryRun,
				askUser,
				provider,
				conversation: event.conversation,
				onProgress: statusReporter
					? (event) => {
							const line = provider.formatInboundStatusLine?.(event);
							if (line) {
								statusReporter.update(line);
							}
						}
					: undefined,
			});

			daemonLog("info", "turn", "turn_complete", {
				integration: event.integration,
				sessionId: record.sessionId,
				deliveredViaTools: turn.deliveredViaTools,
				replyLength: turn.text.length,
				toolActions: turn.appliedActions.length,
			});

			await statusReporter?.clear();

			if (turn.text && !turn.deliveredViaTools) {
				await provider.deliverReply({
					conversation: event.conversation,
					text: turn.text,
					dryRun: active.dryRun,
				});
				daemonLog("debug", "inbound", "reply_delivered", {
					integration: event.integration,
					externalKey: event.externalKey,
				});
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			setChatInboundStatus({
				status: "error",
				detail: msg,
			});
			daemonLog("error", "turn", "turn_failed", {
				integration: event.integration,
				sessionId: record.sessionId,
				message: msg,
			});
			await statusReporter?.clear();
			try {
				await provider.deliverReply({
					conversation: event.conversation,
					text: `Sorry, I hit an error: ${msg}`,
					dryRun: active.dryRun,
				});
			} catch {
				// best effort
			}
		}

		markMessageProcessed(event.integration, event.externalKey, event.messageId);
	});
}

export function createInboundEmitHandler(
	active: ActiveChatInbound,
): (event: InboundChatEvent) => void {
	return (event) => {
		void handleInboundEvent(active, event).catch((error) => {
			const msg = error instanceof Error ? error.message : String(error);
			setChatInboundStatus({ status: "error", detail: msg });
			daemonLog("error", "inbound", "inbound_handler_error", { message: msg });
		});
	};
}

export async function ensureModuleConnected(
	module: IntegrationModule,
): Promise<boolean> {
	try {
		return await module.isConnected();
	} catch {
		return false;
	}
}
