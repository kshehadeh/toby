import type { AskUserHandler } from "../ai/ask-user-tool";
import type { CoreMessage } from "../ai/chat";
import type {
	ChatInboundProvider,
	InboundConversation,
} from "../chat-inbound/types";
import type { Persona } from "../config/index";
import { formatToolStatusLine } from "../format-tool-status";
import type { IntegrationModule } from "../integrations/types";
import { daemonLog } from "../logging/daemon-log";
import { activityLineForChatEvent } from "../pipeline-footer";
import {
	appendTranscriptBatch,
	getSessionLastPretreatment,
	loadChatSession,
	renameChatSession,
} from "../session-store";
import type { ChatEvent } from "./chat-events";
import { type TurnContext, runChatTurnPipeline } from "./pipeline";
import { resolveHeadlessChatModules } from "./resolve-chat-modules";
import { TranscriptAccumulator } from "./transcript-accumulator";
import { insertTurnWorkSummary } from "./turn-work-summary";

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

async function buildInboundPersona(
	persona: Persona,
	provider: ChatInboundProvider | undefined,
	conversation: InboundConversation | undefined,
): Promise<Persona> {
	let appendix = INBOUND_PERSONA_APPENDIX_BASE;
	if (provider && conversation && provider.buildInboundPersonaAppendix) {
		appendix += await provider.buildInboundPersonaAppendix(conversation);
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

export function headlessProgressLineForChatEvent(
	event: ChatEvent,
	personaName?: string,
): string | null {
	if (event.type === "tool_call_start") {
		return formatToolStatusLine(event.toolName);
	}
	return activityLineForChatEvent(event, { personaName });
}

function createHeadlessEventSink(
	onProgress: ((event: ChatEvent) => void) | undefined,
	personaName: string,
	accumulator: TranscriptAccumulator,
): {
	readonly emit: (event: ChatEvent) => void;
	readonly onChatEvent: (event: ChatEvent) => void;
} {
	const handle = (event: ChatEvent) => {
		accumulator.applyEvent(event);
		daemonLog("debug", "turn", "pipeline_event", { type: event.type });
		if (onProgress && headlessProgressLineForChatEvent(event, personaName)) {
			onProgress(event);
		}
	};
	return { emit: handle, onChatEvent: handle };
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
	readonly onProgress?: (event: ChatEvent) => void;
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
		onProgress,
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
	const priorPretreatment = isFirstTurn
		? undefined
		: (getSessionLastPretreatment(sessionId) ?? undefined);
	const inboundPersona = await buildInboundPersona(
		persona,
		provider,
		conversation,
	);

	const startIdx = loaded?.transcript.length ?? 0;
	const userTurnIndex = startIdx;
	const turnStartedAt = Date.now();
	const accumulator = new TranscriptAccumulator(loaded?.transcript ?? []);
	accumulator.addUser(userText);

	let seq = 0;
	const eventSink = createHeadlessEventSink(
		onProgress,
		inboundPersona.name,
		accumulator,
	);
	const ctx: TurnContext = {
		persona: inboundPersona,
		modules,
		dryRun,
		askUser,
		emit: eventSink.emit,
		nextSeq: () => {
			seq += 1;
			return seq;
		},
		emitPersistLifecycle: false,
		chatWithToolsOptions: onProgress
			? { onChatEvent: eventSink.onChatEvent }
			: undefined,
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
			priorPretreatment,
		},
		ctx,
	);

	if (result.stage !== "persist") {
		throw new Error(
			`runHeadlessChatTurn: expected persist stage, got ${result.stage}`,
		);
	}

	const turn = result.turn;
	const reply = turn.text?.trim() ?? "";
	if (
		reply.length > 0 &&
		!accumulator.hasAssistantBodyInSlice(reply, startIdx)
	) {
		accumulator.addAssistantFallback(inboundPersona.name, reply);
	}

	const suggestedSessionName = turn.spec?.sessionName?.trim();
	if (suggestedSessionName) {
		renameChatSession(sessionId, suggestedSessionName);
	}

	appendTranscriptBatch(
		sessionId,
		startIdx,
		insertTurnWorkSummary(
			accumulator.snapshot,
			userTurnIndex,
			Date.now() - turnStartedAt,
		).slice(startIdx),
	);

	return {
		responseMessages: turn.responseMessages,
		text: reply,
		appliedActions: turn.appliedActions,
		deliveredViaTools: appliedActionsIndicateReply(turn.appliedActions),
	};
}
