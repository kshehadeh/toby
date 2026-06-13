import { cancelPlan, loadPlanBySession, skipPhase } from "../../planning/plan-store";
import { loadChatSession } from "../../session-store";
import { errorResponse, jsonResponse, readJsonBody } from "../http-utils";

export function handlePlanSkip(
	sessionId: string,
	req: Request,
): Promise<Response> {
	return readJsonBody<{ planId?: string; phaseId?: string }>(req).then(
		(body) => {
			if (body === null || !body.planId?.trim() || !body.phaseId?.trim()) {
				return errorResponse("Missing planId or phaseId", 400);
			}
			const loaded = loadChatSession(sessionId);
			if (!loaded) {
				return errorResponse("Session not found", 404);
			}
			const plan = loadPlanBySession(sessionId);
			if (!plan || plan.id !== body.planId) {
				return errorResponse("Plan not found for session", 404);
			}
			skipPhase(body.planId, body.phaseId);
			return jsonResponse({ ok: true });
		},
	);
}

export function handlePlanCancel(
	sessionId: string,
	req: Request,
): Promise<Response> {
	return readJsonBody<{ planId?: string }>(req).then((body) => {
		if (body === null || !body.planId?.trim()) {
			return errorResponse("Missing planId", 400);
		}
		const loaded = loadChatSession(sessionId);
		if (!loaded) {
			return errorResponse("Session not found", 404);
		}
		const plan = loadPlanBySession(sessionId);
		if (!plan || plan.id !== body.planId) {
			return errorResponse("Plan not found for session", 404);
		}
		cancelPlan(body.planId);
		return jsonResponse({ ok: true });
	});
}
