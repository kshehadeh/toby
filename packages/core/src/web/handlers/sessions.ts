import { loadPlanBySession } from "../../planning/plan-store";
import { listChatSessions, loadChatSession } from "../../session-store";
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
	return jsonResponse({
		id: session.id,
		name: session.name,
		transcript: session.transcript,
		messageCount: session.messages.length,
		settings: session.settings,
		activePlan: planSummaryForSession(sessionId),
	});
}
