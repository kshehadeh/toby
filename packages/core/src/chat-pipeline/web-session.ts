import type { AskUserHandler } from "../ai/ask-user-tool";
import { daemonLog } from "../logging/daemon-log";
import { resolveDefaultPersona } from "../personas/index";
import {
	getSessionLastPretreatment,
	loadChatSession,
	renameChatSession,
} from "../session-store";
import type { ChatEvent, ChatEventSink } from "./chat-events";
import { type TurnContext, runChatTurnPipeline } from "./pipeline";
import { resolveWebChatModules } from "./resolve-chat-modules";

export type WebChatTurnResult = {
	readonly text: string;
	readonly appliedActions: readonly string[];
	readonly sessionName?: string;
};

const webAskUserHandler: AskUserHandler = async (payload) => ({
	selectedIndex: -1,
	selectedLabel: "",
	rawInput: "",
	error: `The native app cannot prompt for choices yet. Question: ${payload.query}`,
});

function createWebEventSink(onEvent: ChatEventSink): {
	readonly emit: ChatEventSink;
	readonly onChatEvent: ChatEventSink;
} {
	const handle: ChatEventSink = (event) => {
		daemonLog("debug", "turn", "web_pipeline_event", { type: event.type });
		onEvent(event);
	};
	return { emit: handle, onChatEvent: handle };
}

export async function runWebChatTurn(params: {
	readonly sessionId: string;
	readonly userText: string;
	readonly onEvent: ChatEventSink;
	readonly abortSignal?: AbortSignal;
	readonly dryRun?: boolean;
}): Promise<WebChatTurnResult> {
	const { sessionId, userText, onEvent, abortSignal, dryRun = false } = params;

	const loaded = loadChatSession(sessionId);
	if (!loaded) {
		throw new Error(`Session not found: ${sessionId}`);
	}

	const persona = resolveDefaultPersona();
	const { modules, warnings } = await resolveWebChatModules(userText);
	if (warnings.length > 0) {
		daemonLog("warn", "turn", "web_module_warnings", {
			modules: modules.map((m) => m.name),
			warnings,
		});
	}

	const priorMessages = loaded.messages;
	const isFirstTurn = priorMessages.length === 0;
	const priorPretreatment = isFirstTurn
		? undefined
		: (getSessionLastPretreatment(sessionId) ?? undefined);

	let seq = 0;
	const eventSink = createWebEventSink(onEvent);
	const ctx: TurnContext = {
		persona,
		modules,
		dryRun,
		askUser: webAskUserHandler,
		emit: eventSink.emit,
		nextSeq: () => {
			seq += 1;
			return seq;
		},
		emitPersistLifecycle: false,
		abortSignal,
		chatWithToolsOptions: {
			onChatEvent: eventSink.onChatEvent,
			abortSignal,
		},
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
			`runWebChatTurn: expected persist stage, got ${result.stage}`,
		);
	}

	const turn = result.turn;
	const suggestedSessionName = turn.spec?.sessionName?.trim();
	let sessionName: string | undefined;
	if (suggestedSessionName) {
		renameChatSession(sessionId, suggestedSessionName);
		sessionName = suggestedSessionName;
	}
	return {
		text: turn.text?.trim() ?? "",
		appliedActions: turn.appliedActions,
		...(sessionName ? { sessionName } : {}),
	};
}
