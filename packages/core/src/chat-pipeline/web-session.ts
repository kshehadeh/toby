import { daemonLog } from "../logging/daemon-log";
import { resolveDefaultPersona } from "../personas/index";
import type { ChatEventSink } from "./chat-events";
import {
	type ApiChatTurnResult,
	runApiChatTurnWithPersistence,
} from "./turn-runtime";

export type WebChatTurnResult = {
	readonly text: string;
	readonly appliedActions: readonly string[];
	readonly sessionName?: string;
};

/** Legacy adapter — prefer `runApiChatTurnWithPersistence` directly. */
export async function runWebChatTurn(params: {
	readonly sessionId: string;
	readonly userText: string;
	readonly onEvent: ChatEventSink;
	readonly abortSignal?: AbortSignal;
	readonly dryRun?: boolean;
}): Promise<WebChatTurnResult> {
	const persona = resolveDefaultPersona();
	const result: ApiChatTurnResult = await runApiChatTurnWithPersistence({
		sessionId: params.sessionId,
		userText: params.userText,
		onEvent: (event) => {
			daemonLog("debug", "turn", "web_pipeline_event", { type: event.type });
			params.onEvent(event);
		},
		dryRun: params.dryRun,
		abortSignal: params.abortSignal,
		personaNameForFallback: persona.name,
	});
	return {
		text: result.text,
		appliedActions: result.appliedActions,
		...(result.sessionName ? { sessionName: result.sessionName } : {}),
	};
}
