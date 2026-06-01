import type { AskUserHandler } from "@toby/core/ai/ask-user-tool";
import type { ChatWithToolsOptions } from "@toby/core/ai/chat";
import type { ChatEventSink } from "@toby/core/chat-pipeline/chat-events";
import type { TurnContext } from "@toby/core/chat-pipeline/pipeline";
import type { Persona } from "@toby/core/config/index";
import type { IntegrationModule } from "@toby/core/integrations/types";

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
