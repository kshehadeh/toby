import type { LanguageModelUsage, ProviderMetadata } from "ai";
import type { AskUserHandler } from "../ai/ask-user-tool";
import type { ChatWithToolsOptions, CoreMessage } from "../ai/chat";
import type { PriorPretreatment, UserIntentSpec } from "../ai/pretreatment";
import { log, logWithSession } from "../logging/chat-log";
import type { ValidatedChatAttachment } from "./attachments";

export type { PriorPretreatment };
import type { Persona } from "../config/index";
import type { IntegrationModule } from "../integrations/types";
import type { Project } from "../projects/index";
import type { RoutingIndex } from "../routing/index";
import type { LocalSkill } from "../skills/index";
import type { ChatEventSink } from "./chat-events";
import { assembleMessagesNode } from "./nodes/assemble-messages";
import { compactMessagesNode } from "./nodes/compact-messages";
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
	readonly attachments?: readonly ValidatedChatAttachment[];
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
	readonly routingIndex: RoutingIndex | null;
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
	/** Active project context, resolved before the turn starts. */
	readonly project?: Project | null;
	readonly persist?: {
		readonly sessionId: string;
		/**
		 * Index at which PersistTurnNode appends new messages.
		 * CompactMessagesNode may update this after rewriting history.
		 */
		startIdx: number;
	};
	readonly emitPersistLifecycle: boolean;
	/** Wall-clock timestamp (ms) when the turn was submitted. Used for latency logging. */
	readonly turnStartMs?: number;
};

export type PipelineStage =
	| "init"
	| "expand"
	| "assemble"
	| "compact"
	| "run"
	| "persist";

export type RunChatTurnPipelineOptions = {
	readonly stopAfter?: PipelineStage;
	readonly assembled?: AssembledTurn;
};

export type PipelineResult =
	| { readonly stage: "init"; readonly turn: InitedTurn }
	| { readonly stage: "expand"; readonly turn: ExpandedTurn }
	| { readonly stage: "assemble"; readonly turn: AssembledTurn }
	| { readonly stage: "compact"; readonly turn: AssembledTurn }
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
	"compact",
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
	const turnStartMs = ctx.turnStartMs ?? Date.now();
	const sid = ctx.persist?.sessionId ?? null;

	if (options?.assembled) {
		const compactStart = Date.now();
		const compacted = await compactMessagesNode.run(options.assembled, ctx);
		const compactEnd = Date.now();
		logWithSession(sid, undefined, "info", "turn", "stage_timing", {
			stage: "compact",
			durationMs: compactEnd - compactStart,
			elapsedMs: compactEnd - turnStartMs,
		});
		if (stopIdx <= stageIndex("compact")) {
			return { stage: "compact", turn: compacted };
		}

		const ran = await runModelTurnNode.run(compacted, ctx);
		if (stopIdx <= stageIndex("run")) {
			return { stage: "run", turn: ran };
		}
		const committed = await persistTurnNode.run(ran, ctx);
		return { stage: "persist", turn: committed };
	}

	const initStart = Date.now();
	const inited = await turnInitNode.run(request, ctx);
	const initEnd = Date.now();
	logWithSession(sid, undefined, "info", "turn", "stage_timing", {
		stage: "init",
		durationMs: initEnd - initStart,
		elapsedMs: initEnd - turnStartMs,
	});
	if (stopIdx <= stageIndex("init")) {
		return { stage: "init", turn: inited };
	}

	const expandStart = Date.now();
	const expanded = await expandPromptNode.run(inited, ctx);
	const expandEnd = Date.now();
	logWithSession(sid, undefined, "info", "turn", "stage_timing", {
		stage: "expand",
		durationMs: expandEnd - expandStart,
		elapsedMs: expandEnd - turnStartMs,
	});
	if (stopIdx <= stageIndex("expand")) {
		return { stage: "expand", turn: expanded };
	}

	const assembleStart = Date.now();
	const assembled = await assembleMessagesNode.run(expanded, ctx);
	const assembleEnd = Date.now();
	logWithSession(sid, undefined, "info", "turn", "stage_timing", {
		stage: "assemble",
		durationMs: assembleEnd - assembleStart,
		elapsedMs: assembleEnd - turnStartMs,
	});
	if (stopIdx <= stageIndex("assemble")) {
		return { stage: "assemble", turn: assembled };
	}

	const compactStart = Date.now();
	const compacted = await compactMessagesNode.run(assembled, ctx);
	const compactEnd = Date.now();
	logWithSession(sid, undefined, "info", "turn", "stage_timing", {
		stage: "compact",
		durationMs: compactEnd - compactStart,
		elapsedMs: compactEnd - turnStartMs,
	});
	if (stopIdx <= stageIndex("compact")) {
		return { stage: "compact", turn: compacted };
	}

	const runStart = Date.now();
	const ran = await runModelTurnNode.run(compacted, ctx);
	const runEnd = Date.now();
	logWithSession(sid, undefined, "info", "turn", "stage_timing", {
		stage: "run",
		durationMs: runEnd - runStart,
		elapsedMs: runEnd - turnStartMs,
	});
	if (stopIdx <= stageIndex("run")) {
		return { stage: "run", turn: ran };
	}

	const committed = await persistTurnNode.run(ran, ctx);
	const persistEnd = Date.now();
	logWithSession(sid, undefined, "info", "turn", "stage_timing", {
		stage: "persist",
		durationMs: persistEnd - runEnd,
		elapsedMs: persistEnd - turnStartMs,
	});
	return { stage: "persist", turn: committed };
}

export {
	assembleMessagesNode,
	compactMessagesNode,
	expandPromptNode,
	persistTurnNode,
	runModelTurnNode,
	turnInitNode,
};
