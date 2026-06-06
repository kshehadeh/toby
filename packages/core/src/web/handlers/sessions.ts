import { listChatSessions, loadChatSession } from "../../session-store";
import { errorResponse, jsonResponse, parseIntParam } from "../http-utils";

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
	});
}
