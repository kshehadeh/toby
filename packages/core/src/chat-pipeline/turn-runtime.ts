import { randomUUID } from "node:crypto";
import { isAbortError } from "../abort";
import type { AskUserHandler, AskUserToolResult } from "../ai/ask-user-tool";
import {
	type AIContextWindowInfo,
	resolveContextWindowInfo,
} from "../ai/context-window";
import type { ChatSessionSettings } from "../api/chat-api";
import { resolveChatIntegrationModules } from "../chat-integrations";
import type { IntegrationModule } from "../integrations/types";
import { daemonLog } from "../logging/daemon-log";
import {
	listPersonas,
	resolveDefaultPersona,
	resolvePersona,
} from "../personas/index";
import { resolveProject } from "../projects/index";
import {
	appendMessageBatch,
	appendTranscriptBatch,
	getSessionLastPretreatment,
	loadChatSession,
	renameChatSession,
	setSessionContextWindow,
	setSessionLastPretreatment,
} from "../session-store";
import type { ChatEvent, ChatEventSink } from "./chat-events";
import { type TurnContext, runChatTurnPipeline } from "./pipeline";
import { resolveWebChatModules } from "./resolve-chat-modules";
import { TranscriptAccumulator } from "./transcript-accumulator";
import { insertTurnWorkSummary } from "./turn-work-summary";

export type ApiChatTurnResult = {
	readonly turnId: string;
	readonly text: string;
	readonly appliedActions: readonly string[];
	readonly sessionName?: string;
	readonly usage?: import("ai").LanguageModelUsage;
	readonly contextWindow?: AIContextWindowInfo;
	readonly warnings: readonly string[];
};

type PendingAskUser = {
	readonly resolve: (result: AskUserToolResult) => void;
	readonly reject: (error: Error) => void;
};

type ActiveTurn = {
	readonly turnId: string;
	readonly sessionId: string;
	readonly abortController: AbortController;
	readonly pendingAskUsers: Map<string, PendingAskUser>;
};

const activeTurnsBySession = new Map<string, ActiveTurn>();
const activeTurnsById = new Map<string, ActiveTurn>();

export function getActiveTurnForSession(
	sessionId: string,
): ActiveTurn | undefined {
	return activeTurnsBySession.get(sessionId);
}

export function cancelActiveTurn(sessionId: string): boolean {
	const active = activeTurnsBySession.get(sessionId);
	if (!active) {
		return false;
	}
	active.abortController.abort();
	return true;
}

export function cancelTurnById(turnId: string): boolean {
	const active = activeTurnsById.get(turnId);
	if (!active) {
		return false;
	}
	active.abortController.abort();
	return true;
}

export function submitAskUserAnswer(params: {
	readonly sessionId: string;
	readonly turnId: string;
	readonly requestId: string;
	readonly answer: AskUserToolResult;
}): boolean {
	const active = activeTurnsById.get(params.turnId);
	if (!active || active.sessionId !== params.sessionId) {
		return false;
	}
	const pending = active.pendingAskUsers.get(params.requestId);
	if (!pending) {
		return false;
	}
	active.pendingAskUsers.delete(params.requestId);
	pending.resolve(params.answer);
	return true;
}

async function resolveModulesForTurn(params: {
	readonly userText: string;
	readonly settings: ChatSessionSettings;
	readonly modulesOverride?: readonly string[];
}): Promise<{ modules: IntegrationModule[]; warnings: string[] }> {
	if (params.modulesOverride && params.modulesOverride.length > 0) {
		const resolved = await resolveChatIntegrationModules([
			...params.modulesOverride,
		]);
		if (!resolved.ok) {
			return { modules: [], warnings: [resolved.message] };
		}
		return { modules: [...resolved.modules], warnings: [] };
	}
	if (params.settings.modules && params.settings.modules.length > 0) {
		const resolved = await resolveChatIntegrationModules([
			...params.settings.modules,
		]);
		if (!resolved.ok) {
			return { modules: [], warnings: [resolved.message] };
		}
		return { modules: [...resolved.modules], warnings: [] };
	}
	const web = await resolveWebChatModules(params.userText);
	return { modules: [...web.modules], warnings: [...web.warnings] };
}

function resolvePersonaForTurn(params: {
	readonly settings: ChatSessionSettings;
	readonly personaOverride?: string;
	readonly projectPersonaName?: string | null;
}) {
	if (params.personaOverride?.trim()) {
		return (
			resolvePersona(params.personaOverride.trim()) ?? resolveDefaultPersona()
		);
	}
	if (params.settings.persona?.trim()) {
		return (
			resolvePersona(params.settings.persona.trim()) ?? resolveDefaultPersona()
		);
	}
	if (params.projectPersonaName?.trim()) {
		return (
			resolvePersona(params.projectPersonaName.trim()) ??
			resolveDefaultPersona()
		);
	}
	return resolveDefaultPersona();
}

function resolveProjectForTurn(params: {
	readonly settings: ChatSessionSettings;
	readonly projectOverride?: string;
}) {
	const id =
		params.projectOverride?.trim() || params.settings.projectId?.trim();
	return id ? resolveProject(id) : null;
}

function registerActiveTurn(active: ActiveTurn): void {
	activeTurnsBySession.set(active.sessionId, active);
	activeTurnsById.set(active.turnId, active);
}

function unregisterActiveTurn(active: ActiveTurn): void {
	const current = activeTurnsBySession.get(active.sessionId);
	if (current?.turnId === active.turnId) {
		activeTurnsBySession.delete(active.sessionId);
	}
	activeTurnsById.delete(active.turnId);
	for (const pending of active.pendingAskUsers.values()) {
		pending.reject(
			new Error("Turn ended before ask-user answer was received."),
		);
	}
	active.pendingAskUsers.clear();
}

function createApiAskUserHandler(
	active: ActiveTurn,
	emit: ChatEventSink,
): AskUserHandler {
	return async ({ query, options }) =>
		new Promise<AskUserToolResult>((resolve, reject) => {
			const requestId = randomUUID();
			active.pendingAskUsers.set(requestId, { resolve, reject });
			emit({
				type: "ask_user_prompt",
				turnId: active.turnId,
				requestId,
				seq: 0,
				query,
				options,
			});
		});
}

export async function bootstrapChatSession(params: {
	readonly sessionId: string;
	readonly persona?: string;
	readonly modules?: readonly string[];
	readonly dryRun?: boolean;
	readonly initialText?: string;
	readonly projectId?: string;
}): Promise<{ messageCount: number }> {
	const loaded = loadChatSession(params.sessionId);
	if (!loaded) {
		throw new Error(`Session not found: ${params.sessionId}`);
	}
	if (loaded.messages.length > 0) {
		return { messageCount: loaded.messages.length };
	}

	const settings = loaded.settings;
	const project = resolveProjectForTurn({
		settings,
		projectOverride: params.projectId,
	});
	const persona = resolvePersonaForTurn({
		settings,
		personaOverride: params.persona,
		projectPersonaName: project?.personaName ?? null,
	});
	const { modules } = await resolveModulesForTurn({
		userText: params.initialText ?? "",
		settings,
		modulesOverride: params.modules,
	});
	if (modules.length === 0) {
		return { messageCount: loaded.messages.length };
	}

	let seq = 0;
	const ctx: TurnContext = {
		persona,
		modules,
		dryRun: params.dryRun ?? settings.dryRun ?? false,
		project,
		emit: () => {},
		nextSeq: () => {
			seq += 1;
			return seq;
		},
		emitPersistLifecycle: false,
		turnStartMs: Date.now(),
	};

	const result = await runChatTurnPipeline(
		{
			rawUserText: params.initialText ?? "",
			priorMessages: [],
			isFirstTurn: true,
		},
		ctx,
		{ stopAfter: "assemble" },
	);

	if (result.stage !== "assemble") {
		throw new Error(`bootstrap: expected assemble, got ${result.stage}`);
	}

	const messages = result.turn.messages;
	appendMessageBatch(params.sessionId, 0, messages);
	if (result.turn.spec) {
		setSessionLastPretreatment(params.sessionId, {
			rawUserText: params.initialText ?? "",
			spec: result.turn.spec,
		});
	}
	return { messageCount: messages.length };
}

export async function runApiChatTurn(params: {
	readonly sessionId: string;
	readonly userText: string;
	readonly onEvent: ChatEventSink;
	readonly persona?: string;
	readonly modules?: readonly string[];
	readonly dryRun?: boolean;
	readonly steering?: boolean;
	readonly abortSignal?: AbortSignal;
	readonly clientTurnId?: string;
	readonly projectId?: string;
}): Promise<ApiChatTurnResult> {
	const turnId = params.clientTurnId?.trim() || randomUUID();

	if (params.steering) {
		cancelActiveTurn(params.sessionId);
	}

	const loaded = loadChatSession(params.sessionId);
	if (!loaded) {
		throw new Error(`Session not found: ${params.sessionId}`);
	}

	const project = resolveProjectForTurn({
		settings: loaded.settings,
		projectOverride: params.projectId,
	});
	const persona = resolvePersonaForTurn({
		settings: loaded.settings,
		personaOverride: params.persona,
		projectPersonaName: project?.personaName ?? null,
	});
	const { modules, warnings } = await resolveModulesForTurn({
		userText: params.userText,
		settings: loaded.settings,
		modulesOverride: params.modules,
	});
	if (warnings.length > 0) {
		daemonLog("warn", "turn", "api_module_warnings", {
			modules: modules.map((m) => m.name),
			warnings,
		});
	}

	const priorMessages = loaded.messages;
	const isFirstTurn = priorMessages.length === 0;
	const priorPretreatment = isFirstTurn
		? undefined
		: (getSessionLastPretreatment(params.sessionId) ?? undefined);

	const abortController = new AbortController();
	const linkedAbort = params.abortSignal;
	if (linkedAbort) {
		if (linkedAbort.aborted) {
			abortController.abort();
		} else {
			linkedAbort.addEventListener(
				"abort",
				() => {
					abortController.abort();
				},
				{ once: true },
			);
		}
	}

	const active: ActiveTurn = {
		turnId,
		sessionId: params.sessionId,
		abortController,
		pendingAskUsers: new Map(),
	};
	registerActiveTurn(active);

	let seq = 0;
	const emit: ChatEventSink = (event) => {
		// Skip high-frequency streaming deltas to avoid log pollution
		if (event.type !== "assistant_text_delta") {
			daemonLog("debug", "turn", "api_pipeline_event", { type: event.type });
		}
		params.onEvent(event);
	};

	const ctx: TurnContext = {
		persona,
		modules,
		dryRun: params.dryRun ?? loaded.settings.dryRun ?? false,
		askUser: createApiAskUserHandler(active, emit),
		emit,
		nextSeq: () => {
			seq += 1;
			return seq;
		},
		emitPersistLifecycle: false,
		abortSignal: abortController.signal,
		chatWithToolsOptions: {
			onChatEvent: emit,
			abortSignal: abortController.signal,
		},
		project,
		persist: {
			sessionId: params.sessionId,
			startIdx: priorMessages.length,
		},
		turnStartMs: Date.now(),
	};

	try {
		const result = await runChatTurnPipeline(
			{
				rawUserText: params.userText,
				priorMessages,
				isFirstTurn,
				priorPretreatment,
			},
			ctx,
		);

		if (result.stage !== "persist") {
			throw new Error(
				`runApiChatTurn: expected persist stage, got ${result.stage}`,
			);
		}

		const turn = result.turn;
		const suggestedSessionName = turn.spec?.sessionName?.trim();
		let sessionName: string | undefined;
		if (suggestedSessionName) {
			renameChatSession(params.sessionId, suggestedSessionName);
			sessionName = suggestedSessionName;
		}

		if (turn.spec) {
			setSessionLastPretreatment(params.sessionId, {
				rawUserText: params.userText,
				spec: turn.spec,
			});
		}

		const contextWindow = await resolveContextWindowInfo({
			providerId: persona.ai.provider,
			model: persona.ai.model,
			usage: turn.usage,
		});
		setSessionContextWindow(params.sessionId, contextWindow);

		return {
			turnId,
			text: turn.text?.trim() ?? "",
			appliedActions: turn.appliedActions,
			...(sessionName ? { sessionName } : {}),
			usage: turn.usage,
			...(contextWindow ? { contextWindow } : {}),
			warnings,
		};
	} catch (error) {
		if (isAbortError(error)) {
			throw error;
		}
		throw error;
	} finally {
		unregisterActiveTurn(active);
	}
}

export async function runApiChatTurnWithPersistence(params: {
	readonly sessionId: string;
	readonly userText: string;
	readonly onEvent: ChatEventSink;
	readonly persona?: string;
	readonly modules?: readonly string[];
	readonly dryRun?: boolean;
	readonly steering?: boolean;
	readonly abortSignal?: AbortSignal;
	readonly clientTurnId?: string;
	readonly personaNameForFallback?: string;
	readonly projectId?: string;
}): Promise<ApiChatTurnResult> {
	const loaded = loadChatSession(params.sessionId);
	if (!loaded) {
		throw new Error(`Session not found: ${params.sessionId}`);
	}

	const startIdx = loaded.transcript.length;
	const userTurnIndex = startIdx;
	const turnStartedAt = Date.now();
	const accumulator = new TranscriptAccumulator(loaded.transcript);
	accumulator.addUser(params.userText);

	const persona = resolvePersonaForTurn({
		settings: loaded.settings,
		personaOverride: params.persona,
		projectPersonaName: resolveProjectForTurn({
			settings: loaded.settings,
			projectOverride: params.projectId,
		})?.personaName,
	});

	const result = await runApiChatTurn({
		...params,
		onEvent: (event) => {
			accumulator.applyEvent(event);
			params.onEvent(event);
		},
	});

	const reply = result.text.trim();
	if (
		reply.length > 0 &&
		!accumulator.hasAssistantBodyInSlice(reply, startIdx)
	) {
		accumulator.addAssistantFallback(
			params.personaNameForFallback ?? persona.name,
			reply,
		);
	}

	appendTranscriptBatch(
		params.sessionId,
		startIdx,
		insertTurnWorkSummary(
			accumulator.snapshot,
			userTurnIndex,
			Date.now() - turnStartedAt,
		).slice(startIdx),
	);

	return result;
}

export function listPersonaOptions() {
	return listPersonas().map((p) => ({
		name: p.name,
		label: p.name,
		imagePath: p.imagePath,
	}));
}
