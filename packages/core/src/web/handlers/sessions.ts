import fs from "node:fs";
import { getDefaultPersonaImagePath } from "../../config/index";
import { resolveDefaultPersona, resolvePersona } from "../../personas/index";
import { loadPlanBySession } from "../../planning/plan-store";
import {
	listChatSessions,
	loadChatSession,
	loadExternalSessionBySessionId,
} from "../../session-store";
import { errorResponse, jsonResponse, parseIntParam } from "../http-utils";

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

export function handleSessionsList(url: URL): Response {
	const limit = parseIntParam(url.searchParams.get("limit"), 50, 500);
	const sessions = listChatSessions(limit);
	return jsonResponse({ sessions });
}

export function handleSessionDetail(sessionId: string): Response {
	const session = loadChatSession(sessionId);
	if (!session) {
		return errorResponse("Session not found", 404);
	}
	const external = loadExternalSessionBySessionId(sessionId);

	// Resolve persona image URL for the session's persona (or default).
	const personaName = session.settings?.persona;
	const persona = personaName
		? resolvePersona(personaName)
		: resolveDefaultPersona();
	const hasDefaultImage = fs.existsSync(getDefaultPersonaImagePath());
	const personaImageUrl = persona?.imagePath
		? `/api/personas/image/${encodeURIComponent(persona.imagePath)}`
		: hasDefaultImage
			? "/api/personas/image/default.png"
			: undefined;

	return jsonResponse({
		id: session.id,
		name: session.name,
		transcript: session.transcript,
		messageCount: session.messages.length,
		settings: session.settings,
		...(session.contextWindow ? { contextWindow: session.contextWindow } : {}),
		personaImageUrl,
		activePlan: planSummaryForSession(sessionId),
		integration: external?.integration ?? null,
		externalKey: external?.externalKey ?? null,
	});
}
