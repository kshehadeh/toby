import type { AskUserHandler } from "../ai/ask-user-tool";
import type { CoreMessage } from "../ai/chat";
import type {
	ChatInboundProvider,
	InboundConversation,
} from "../chat-inbound/types";
import type { Persona } from "../config/index";
import type { IntegrationModule } from "../integrations/types";
import { daemonLog } from "../logging/daemon-log";
import { loadChatSession } from "../ui/chat/session-store";
import type { ChatEvent } from "./chat-events";
import { type TurnContext, runChatTurnPipeline } from "./pipeline";
import { resolveHeadlessChatModules } from "./resolve-chat-modules";

const INBOUND_PERSONA_APPENDIX_BASE = `

---

## Inbound chat policy

You are replying in an external chat thread (not the Toby terminal). The user cannot see plain-text multiple-choice questions—use the **askUser** tool when you need a decision. When posting to the same thread, prefer the integration's reply-in-thread tool with the channel and thread identifiers from context. Complete the request without asking unnecessary follow-up questions in prose alone.
`;

export type HeadlessTurnResult = {
	readonly responseMessages: CoreMessage[];
	readonly text: string;
	readonly appliedActions: readonly string[];
	readonly deliveredViaTools: boolean;
};

function buildInboundPersona(
	persona: Persona,
	provider: ChatInboundProvider | undefined,
	conversation: InboundConversation | undefined,
): Persona {
	let appendix = INBOUND_PERSONA_APPENDIX_BASE;
	if (provider && conversation && provider.buildInboundPersonaAppendix) {
		appendix += provider.buildInboundPersonaAppendix(conversation);
	}
	return {
		...persona,
		instructions: persona.instructions + appendix,
	};
}

function appliedActionsIndicateReply(
	appliedActions: readonly string[],
): boolean {
	return appliedActions.some(
		(a) =>
			/Posted message to Slack/i.test(a) ||
			/Replied in Slack thread/i.test(a) ||
			/\[DRY RUN\] Would (post|reply)/i.test(a),
	);
}

function createHeadlessEventSink(): (event: ChatEvent) => void {
	return (event) => {
		daemonLog("debug", "turn", "pipeline_event", { type: event.type });
	};
}

export async function runHeadlessChatTurn(params: {
	readonly inboundModule: IntegrationModule;
	readonly sessionId: string;
	readonly userText: string;
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly askUser?: AskUserHandler;
	readonly provider?: ChatInboundProvider;
	readonly conversation?: InboundConversation;
}): Promise<HeadlessTurnResult> {
	const {
		inboundModule,
		sessionId,
		userText,
		persona,
		dryRun,
		askUser,
		provider,
		conversation,
	} = params;

	const { modules, warnings } = await resolveHeadlessChatModules(
		userText,
		inboundModule,
	);
	if (warnings.length > 0) {
		daemonLog("warn", "turn", "headless_module_warnings", {
			modules: modules.map((m) => m.name),
			warnings,
		});
	}
	daemonLog("debug", "turn", "headless_modules", {
		modules: modules.map((m) => m.name),
	});

	const loaded = loadChatSession(sessionId);
	const priorMessages = loaded?.messages ?? [];
	const isFirstTurn = priorMessages.length === 0;
	const inboundPersona = buildInboundPersona(persona, provider, conversation);

	let seq = 0;
	const ctx: TurnContext = {
		persona: inboundPersona,
		modules,
		dryRun,
		askUser,
		emit: createHeadlessEventSink(),
		nextSeq: () => {
			seq += 1;
			return seq;
		},
		emitPersistLifecycle: false,
		persist: {
			sessionId,
			startIdx: priorMessages.length,
		},
	};

	const result = await runChatTurnPipeline(
		{
			rawUserText: userText,
			priorMessages,
			isFirstTurn,
		},
		ctx,
	);

	if (result.stage !== "persist") {
		throw new Error(
			`runHeadlessChatTurn: expected persist stage, got ${result.stage}`,
		);
	}

	const turn = result.turn;
	return {
		responseMessages: turn.responseMessages,
		text: turn.text?.trim() ?? "",
		appliedActions: turn.appliedActions,
		deliveredViaTools: appliedActionsIndicateReply(turn.appliedActions),
	};
}
