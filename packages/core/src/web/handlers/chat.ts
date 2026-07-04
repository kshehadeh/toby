import fs from "node:fs";
import type { AskUserToolResult } from "../../ai/ask-user-tool";
import { resolveContextWindowInfo } from "../../ai/context-window";
import { formatPersonaAiLabel } from "../../ai/model-factory";
import { isWebSearchAvailable } from "../../ai/web-search-global-tools";
import type {
	CreateSessionRequest,
	PatchSessionRequest,
	TurnRequestBody,
} from "../../api/chat-api";
import type { ChatEvent } from "../../chat-pipeline/chat-events";
import { listUsableChatModules } from "../../chat-pipeline/resolve-chat-modules";
import {
	bootstrapChatSession,
	cancelTurnById,
	runApiChatTurnWithPersistence,
	submitAskUserAnswer,
} from "../../chat-pipeline/turn-runtime";
import { getDefaultPersonaImagePath, resolveTobyDir } from "../../config/index";
import { isTranscriptionConfigured } from "../../listen/transcription-providers";
import { resolveDefaultPersona } from "../../personas/index";
import { loadPlanBySession } from "../../planning/plan-store";
import {
	createChatSession,
	deleteChatSession,
	loadChatSession,
	mergeSessionSettings,
	renameChatSession,
} from "../../session-store";
import { loadLocalSkills } from "../../skills/index";
import { getTobyVersion } from "../../version";
import { errorResponse, jsonResponse, readJsonBody } from "../http-utils";

function sseHeaders(): HeadersInit {
	return {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	};
}

function encodeSseData(data: unknown): Uint8Array {
	return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

function encodeSseEvent(event: string, data: unknown): Uint8Array {
	return new TextEncoder().encode(
		`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
	);
}

function encodeSseComment(comment: string): Uint8Array {
	return new TextEncoder().encode(`: ${comment}\n\n`);
}

function planSummaryForSession(sessionId: string) {
	const plan = loadPlanBySession(sessionId);
	if (!plan) return null;
	return {
		id: plan.id,
		goal: plan.goal,
		status: plan.status,
		phases: plan.phases.map((p) => ({
			id: p.id,
			label: p.label,
			status: p.status,
		})),
	};
}

export async function handleChatStatusDetail(): Promise<Response> {
	const persona = resolveDefaultPersona();
	const modules = await listUsableChatModules();
	const skills = loadLocalSkills();
	const hasDefaultImage = fs.existsSync(getDefaultPersonaImagePath());
	const personaImageUrl = persona.imagePath
		? `/api/personas/image/${encodeURIComponent(persona.imagePath)}`
		: hasDefaultImage
			? "/api/personas/image/default.png"
			: undefined;
	return jsonResponse({
		version: getTobyVersion(),
		persona: persona.name,
		model: formatPersonaAiLabel(persona),
		tobyDir: resolveTobyDir(),
		contextWindow: await resolveContextWindowInfo({
			providerId: persona.ai.provider,
			model: persona.ai.model,
		}),
		personaImageUrl,
		connectedIntegrations: modules.map((m) => m.displayName),
		skillCount: skills.length,
		skills: skills.map((s) => ({ name: s.name, description: s.description })),
		transcription: {
			configured: isTranscriptionConfigured(),
			settingsNavKey: "transcription",
		},
		webSearch: {
			configured: isWebSearchAvailable(persona),
			settingsNavKey: "webSearch",
		},
	});
}

export async function handleCreateSession(req: Request): Promise<Response> {
	const body = (await readJsonBody<CreateSessionRequest>(req)) ?? {};
	const settings = {
		...(body.persona ? { persona: body.persona } : {}),
		...(body.modules ? { modules: body.modules } : {}),
		...(body.dryRun !== undefined ? { dryRun: body.dryRun } : {}),
		...(body.debug !== undefined ? { debug: body.debug } : {}),
	};
	const session = createChatSession({
		name: body.name?.trim() || "New chat",
		settings,
	});
	if (body.bootstrap) {
		await bootstrapChatSession({
			sessionId: session.id,
			persona: body.persona,
			...(body.modules && body.modules.length > 0
				? { modules: body.modules }
				: {}),
			dryRun: body.dryRun,
		});
	}
	return jsonResponse({ id: session.id, name: session.name, settings }, 201);
}

export function handlePatchSession(
	sessionId: string,
	req: Request,
): Promise<Response> {
	return readJsonBody<PatchSessionRequest>(req).then((body) => {
		if (body === null) {
			return errorResponse("Invalid JSON body", 400);
		}
		const loaded = loadChatSession(sessionId);
		if (!loaded) {
			return errorResponse("Session not found", 404);
		}
		if (body.name?.trim()) {
			renameChatSession(sessionId, body.name.trim());
		}
		const settings = mergeSessionSettings(sessionId, {
			...(body.persona !== undefined ? { persona: body.persona } : {}),
			...(body.modules !== undefined ? { modules: body.modules } : {}),
			...(body.dryRun !== undefined ? { dryRun: body.dryRun } : {}),
			...(body.debug !== undefined ? { debug: body.debug } : {}),
		});
		const refreshed = loadChatSession(sessionId);
		return jsonResponse({
			id: sessionId,
			name: refreshed?.name ?? loaded.name,
			settings,
		});
	});
}

export function handleDeleteSession(sessionId: string): Response {
	if (!deleteChatSession(sessionId)) {
		return errorResponse("Session not found", 404);
	}
	return jsonResponse({ ok: true });
}

export async function handleSessionBootstrap(
	sessionId: string,
	req: Request,
): Promise<Response> {
	const loaded = loadChatSession(sessionId);
	if (!loaded) {
		return errorResponse("Session not found", 404);
	}
	const body = (await readJsonBody<{ initialText?: string }>(req)) ?? undefined;
	try {
		const result = await bootstrapChatSession({
			sessionId,
			initialText: body?.initialText,
			persona: loaded.settings.persona,
			modules: loaded.settings.modules,
			dryRun: loaded.settings.dryRun,
		});
		return jsonResponse(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 500);
	}
}

export async function handleSessionTurn(
	sessionId: string,
	req: Request,
): Promise<Response> {
	const body = await readJsonBody<TurnRequestBody>(req);
	if (body === null) {
		return errorResponse("Invalid JSON body", 400);
	}
	const text = body.text?.trim() ?? "";
	if (!text) {
		return errorResponse("Missing text", 400);
	}

	const loaded = loadChatSession(sessionId);
	if (!loaded) {
		return errorResponse("Session not found", 404);
	}

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encodeSseComment("keep-alive"));
				} catch {
					clearInterval(heartbeat);
				}
			}, 5000);

			const emit = (event: ChatEvent) => {
				if (event.type === "ask_user_prompt") {
					controller.enqueue(
						encodeSseEvent("ask_user_prompt", {
							turnId: event.turnId,
							requestId: event.requestId,
							query: event.query,
							options: event.options,
						}),
					);
					return;
				}
				controller.enqueue(encodeSseData(event));
			};

			try {
				const persona = resolveDefaultPersona();
				const result = await runApiChatTurnWithPersistence({
					sessionId,
					userText: text,
					onEvent: emit,
					persona: body.persona,
					modules: body.modules,
					dryRun: body.dryRun,
					steering: body.steering,
					clientTurnId: body.clientTurnId,
					personaNameForFallback: persona.name,
				});
				controller.enqueue(
					encodeSseEvent("done", {
						turnId: result.turnId,
						text: result.text,
						appliedActions: result.appliedActions,
						...(result.sessionName ? { sessionName: result.sessionName } : {}),
						...(result.usage ? { usage: result.usage } : {}),
						...(result.contextWindow
							? { contextWindow: result.contextWindow }
							: {}),
						...(result.warnings.length > 0
							? { warnings: result.warnings }
							: {}),
					}),
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				controller.enqueue(encodeSseEvent("error", { error: message }));
			} finally {
				clearInterval(heartbeat);
				controller.close();
			}
		},
	});

	return new Response(stream, { headers: sseHeaders() });
}

export async function handleCancelTurn(
	sessionId: string,
	turnId: string,
): Promise<Response> {
	const cancelled = cancelTurnById(turnId);
	if (!cancelled) {
		return errorResponse("Turn not found or already completed", 404);
	}
	const loaded = loadChatSession(sessionId);
	if (!loaded) {
		return errorResponse("Session not found", 404);
	}
	return jsonResponse({ ok: true, cancelled: true });
}

export async function handleAskUserAnswer(
	sessionId: string,
	turnId: string,
	requestId: string,
	req: Request,
): Promise<Response> {
	const body = await readJsonBody<{
		selectedIndex?: number;
		selectedLabel?: string;
		rawInput?: string;
		error?: string;
	}>(req);
	if (body === null) {
		return errorResponse("Invalid JSON body", 400);
	}
	const answer: AskUserToolResult = {
		selectedIndex: body.selectedIndex ?? -1,
		selectedLabel: body.selectedLabel ?? "",
		rawInput: body.rawInput ?? "",
		...(body.error ? { error: body.error } : {}),
	};
	const ok = submitAskUserAnswer({
		sessionId,
		turnId,
		requestId,
		answer,
	});
	if (!ok) {
		return errorResponse("Ask-user prompt not found", 404);
	}
	return jsonResponse({ ok: true });
}

export function handleSessionPlanDetail(sessionId: string): Response {
	const loaded = loadChatSession(sessionId);
	if (!loaded) {
		return errorResponse("Session not found", 404);
	}
	return jsonResponse({ plan: planSummaryForSession(sessionId) });
}
