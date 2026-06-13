import { formatPersonaAiLabel } from "../../ai/model-factory";
import type { ChatEvent } from "../../chat-pipeline/chat-events";
import { listUsableChatModules } from "../../chat-pipeline/resolve-chat-modules";
import { runWebChatTurn } from "../../chat-pipeline/web-session";
import { resolveDefaultPersona } from "../../personas/index";
import {
	appendTranscriptBatch,
	createChatSession,
	loadChatSession,
} from "../../session-store";
import { loadLocalSkills } from "../../skills/index";
import { getTobyVersion } from "../../version";
import { errorResponse, jsonResponse, readJsonBody } from "../http-utils";
import { WebTranscriptAccumulator } from "../transcript-accumulator";

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

export async function handleChatStatusDetail(): Promise<Response> {
	const persona = resolveDefaultPersona();
	const modules = await listUsableChatModules();
	const skills = loadLocalSkills();
	return jsonResponse({
		version: getTobyVersion(),
		persona: persona.name,
		model: formatPersonaAiLabel(persona),
		connectedIntegrations: modules.map((m) => m.displayName),
		skillCount: skills.length,
	});
}

export function handleCreateSession(): Response {
	const session = createChatSession({ name: "New chat" });
	return jsonResponse({ id: session.id, name: session.name }, 201);
}

export async function handleSessionTurn(
	sessionId: string,
	req: Request,
): Promise<Response> {
	const body = await readJsonBody<{ text?: string }>(req);
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

	const startIdx = loaded.transcript.length;
	const accumulator = new WebTranscriptAccumulator(loaded.transcript);
	accumulator.addUser(text);

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
				accumulator.applyEvent(event);
				controller.enqueue(encodeSseData(event));
			};
			try {
				const persona = resolveDefaultPersona();
				const result = await runWebChatTurn({
					sessionId,
					userText: text,
					onEvent: emit,
				});
				const reply = result.text.trim();
				if (
					reply.length > 0 &&
					!accumulator.hasAssistantBodyInSlice(reply, startIdx)
				) {
					accumulator.addAssistantFallback(persona.name, reply);
				}
				const nextTranscript = accumulator.snapshot;
				appendTranscriptBatch(
					sessionId,
					startIdx,
					nextTranscript.slice(startIdx),
				);
				controller.enqueue(
					encodeSseEvent("done", {
						text: result.text,
						appliedActions: result.appliedActions,
						...(result.sessionName ? { sessionName: result.sessionName } : {}),
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
