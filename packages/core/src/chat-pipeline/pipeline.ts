import type { LanguageModelUsage, ProviderMetadata } from "ai";
import type { AskUserHandler } from "../ai/ask-user-tool";
import type { ChatWithToolsOptions, CoreMessage } from "../ai/chat";
import type { PriorPretreatment, UserIntentSpec } from "../ai/pretreatment";

export type { PriorPretreatment };
import type { Persona } from "../config/index";
import type { IntegrationModule } from "../integrations/types";
import type { LocalSkill } from "../skills/index";
import type { ChatEventSink } from "./chat-events";
import { assembleMessagesNode } from "./nodes/assemble-messages";
import { expandPromptNode } from "./nodes/expand-prompt";
import { persistTurnNode } from "./nodes/persist-turn";
import { runModelTurnNode } from "./nodes/run-model-turn";
import { turnInitNode } from "./nodes/turn-init";
import type { buildToolsCatalogForPretreatment } from "./run-turn";

export interface PipelineNode<In, Out> {
	readonly name: string;
	run(input: In, ctx: TurnContext): Promise<Out>;
}

export type ToolCatalogInfo = Awaited<
	ReturnType<typeof buildToolsCatalogForPretreatment>
>;

export type TurnRequest = {
	readonly rawUserText: string;
	readonly priorMessages: readonly CoreMessage[];
	readonly isFirstTurn: boolean;
	/** Previous turn verbatim prompt + spec for follow-up reuse / delta pretreatment. */
	readonly priorPretreatment?: PriorPretreatment;
};

export type InitedTurn = TurnRequest & {
	readonly localSkills: readonly LocalSkill[];
	readonly toolCatalog: ToolCatalogInfo;
	readonly willPretreat: boolean;
	readonly integrationLabel: string;
};

export type ExpandedTurn = InitedTurn & {
	readonly effectiveText: string;
	readonly spec: UserIntentSpec | null;
	readonly prepId: string | null;
};

export type AssembledTurn = ExpandedTurn & {
	readonly messages: CoreMessage[];
};

export type RanTurn = AssembledTurn & {
	readonly text: string;
	readonly toolCalls: { name: string; args: Record<string, unknown> }[];
	readonly appliedActions: readonly string[];
	readonly responseMessages: CoreMessage[];
	readonly usage?: LanguageModelUsage;
	readonly providerMetadata?: ProviderMetadata;
};

export type CommittedTurn = RanTurn & {
	readonly messagesAfterTurn: CoreMessage[];
};

export type TurnContext = {
	readonly persona: Persona;
	readonly modules: readonly IntegrationModule[];
	readonly dryRun: boolean;
	readonly abortSignal?: AbortSignal;
	readonly askUser?: AskUserHandler;
	readonly emit: ChatEventSink;
	readonly nextSeq: () => number;
	readonly onStatusLine?: (line: string) => void | Promise<void>;
	readonly chatWithToolsOptions?: ChatWithToolsOptions;
	readonly persist?: {
		readonly sessionId: string;
		readonly startIdx: number;
	};
	readonly emitPersistLifecycle: boolean;
};

export type PipelineStage = "init" | "expand" | "assemble" | "run" | "persist";

export type RunChatTurnPipelineOptions = {
	readonly stopAfter?: PipelineStage;
	readonly assembled?: AssembledTurn;
};

export type PipelineResult =
	| { readonly stage: "init"; readonly turn: InitedTurn }
	| { readonly stage: "expand"; readonly turn: ExpandedTurn }
	| { readonly stage: "assemble"; readonly turn: AssembledTurn }
	| { readonly stage: "run"; readonly turn: RanTurn }
	| { readonly stage: "persist"; readonly turn: CommittedTurn };

export function withAssembledMessages(
	assembled: AssembledTurn,
	messages: CoreMessage[],
): AssembledTurn {
	return { ...assembled, messages };
}

const STAGE_ORDER: readonly PipelineStage[] = [
	"init",
	"expand",
	"assemble",
	"run",
	"persist",
];

function stageIndex(stage: PipelineStage): number {
	return STAGE_ORDER.indexOf(stage);
}

export async function runChatTurnPipeline(
	request: TurnRequest,
	ctx: TurnContext,
	options?: RunChatTurnPipelineOptions,
): Promise<PipelineResult> {
	const stopAfter = options?.stopAfter ?? "persist";
	const stopIdx = stageIndex(stopAfter);

	if (options?.assembled) {
		const ran = await runModelTurnNode.run(options.assembled, ctx);
		if (stopIdx <= stageIndex("run")) {
			return { stage: "run", turn: ran };
		}
		const committed = await persistTurnNode.run(ran, ctx);
		return { stage: "persist", turn: committed };
	}

	const inited = await turnInitNode.run(request, ctx);
	if (stopIdx <= stageIndex("init")) {
		return { stage: "init", turn: inited };
	}

	const expanded = await expandPromptNode.run(inited, ctx);
	if (stopIdx <= stageIndex("expand")) {
		return { stage: "expand", turn: expanded };
	}

	const assembled = await assembleMessagesNode.run(expanded, ctx);
	if (stopIdx <= stageIndex("assemble")) {
		return { stage: "assemble", turn: assembled };
	}

	const ran = await runModelTurnNode.run(assembled, ctx);
	if (stopIdx <= stageIndex("run")) {
		return { stage: "run", turn: ran };
	}

	const committed = await persistTurnNode.run(ran, ctx);
	return { stage: "persist", turn: committed };
}

export {
	assembleMessagesNode,
	expandPromptNode,
	persistTurnNode,
	runModelTurnNode,
	turnInitNode,
};
