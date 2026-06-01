import type { AskUserHandler } from "../../ai/ask-user-tool";
import type { ChatWithToolsOptions } from "../../ai/chat";
import type { ChatEventSink } from "../../chat-pipeline/chat-events";
import type { TurnContext } from "../../chat-pipeline/pipeline";
import type { Persona } from "../../config/index";
import type { IntegrationModule } from "../../integrations/types";

export function buildUiTurnContext(params: {
	readonly persona: Persona;
	readonly modules: readonly IntegrationModule[];
	readonly dryRun: boolean;
	readonly emit: ChatEventSink;
	readonly nextSeq: () => number;
	readonly abortSignal?: AbortSignal;
	readonly askUser?: AskUserHandler;
	readonly chatWithToolsOptions?: ChatWithToolsOptions;
	readonly onStatusLine?: (line: string) => void | Promise<void>;
	readonly emitPersistLifecycle?: boolean;
}): TurnContext {
	return {
		persona: params.persona,
		modules: params.modules,
		dryRun: params.dryRun,
		emit: params.emit,
		nextSeq: params.nextSeq,
		abortSignal: params.abortSignal,
		askUser: params.askUser,
		chatWithToolsOptions: params.chatWithToolsOptions,
		onStatusLine: params.onStatusLine,
		emitPersistLifecycle: params.emitPersistLifecycle ?? false,
	};
}
