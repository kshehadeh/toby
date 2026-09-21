import { clearModelListCache } from "../../ai/model-list";
import { clearPlanUsageCache } from "../../ai/plan-usage";
import {
	OAuthSessionError,
	openRouterOAuthSessions,
} from "../../ai/provider-setup/openrouter-oauth";
import { invalidateSettingsCache } from "../../configure/settings-cache";
import { errorResponse, jsonResponse } from "../http-utils";

export async function handleOpenRouterOAuth(
	req: Request,
	id?: string,
	finish = false,
): Promise<Response> {
	// Native requests have no Origin. Do not let arbitrary web pages start or
	// inspect local sign-in sessions (including DNS-rebinding origins).
	if (
		req.headers.has("Origin") ||
		req.headers.has("Sec-Fetch-Site") ||
		!["127.0.0.1", "localhost", "[::1]"].includes(new URL(req.url).hostname)
	)
		return errorResponse("Browser access is not allowed.", 403);
	try {
		let response: Response;
		if (!id && req.method === "POST")
			response = jsonResponse(openRouterOAuthSessions.start());
		else if (id && finish && req.method === "POST") {
			const result = await openRouterOAuthSessions.finish(id);
			if (!result.ok) return errorResponse(result.error, result.status ?? 400);
			invalidateSettingsCache();
			clearModelListCache("openrouter");
			clearPlanUsageCache("openrouter");
			response = jsonResponse({ ...result, configured: true });
		} else if (id && !finish && req.method === "GET")
			response = jsonResponse(openRouterOAuthSessions.get(id));
		else if (id && !finish && req.method === "DELETE") {
			openRouterOAuthSessions.cancel(id);
			response = jsonResponse({ ok: true });
		} else return errorResponse("Method not allowed", 405);
		response.headers.set("Cache-Control", "no-store");
		return response;
	} catch (error) {
		return errorResponse(
			error instanceof OAuthSessionError
				? error.message
				: "Toby couldn’t start sign-in. Try again.",
			error instanceof OAuthSessionError ? error.status : 500,
		);
	}
}
