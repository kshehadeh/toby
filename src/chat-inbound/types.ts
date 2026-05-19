import type { Persona } from "../config/index";
import type { IntegrationModule } from "../integrations/types";
import type { PendingAskUser } from "../ui/chat/session-store";

/** Stable id for one external conversation (channel + thread). Provider computes this. */
export type ExternalConversationKey = string;

/** Provider-neutral handle for deliver/askUser callbacks. */
export interface InboundConversation {
	readonly externalKey: ExternalConversationKey;
	readonly displayName: string;
	readonly metadata: Record<string, unknown>;
}

/** Normalized inbound message after provider-specific filtering. */
export interface InboundChatEvent {
	readonly integration: string;
	readonly externalKey: ExternalConversationKey;
	readonly messageId: string;
	readonly text: string;
	readonly authorId: string;
	/** True = start/continue a chat turn; false = only valid for askUser resume. */
	readonly isNewConversationTurn: boolean;
	readonly conversation: InboundConversation;
	/** When set, router skips events from this author (bot loop prevention). */
	readonly botUserId?: string;
}

export interface ChatInboundStartContext {
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly signal: AbortSignal;
	readonly emit: (event: InboundChatEvent) => void;
}

export interface ChatInboundProvider {
	start(ctx: ChatInboundStartContext): Promise<() => void>;
	buildInboundPersonaAppendix?(conversation: InboundConversation): string;
	deliverReply(params: {
		conversation: InboundConversation;
		text: string;
		dryRun: boolean;
	}): Promise<void>;
	deliverAskUser(params: {
		conversation: InboundConversation;
		question: string;
		options: readonly string[];
		dryRun: boolean;
	}): Promise<void>;
	matchesAskUserReply?(
		event: InboundChatEvent,
		pending: PendingAskUser,
	): boolean;
}

export type ActiveChatInbound = {
	readonly module: IntegrationModule;
	readonly persona: Persona;
	readonly dryRun: boolean;
};
