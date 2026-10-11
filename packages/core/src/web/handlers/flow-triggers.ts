import { nativeTriggerCatalog } from "../../flows/triggers/native-types";
import { listTriggerDecisions } from "../../flows/triggers/store";
import { flowTriggerSourceStatus } from "../../flows/triggers/supervisor";
import { errorResponse, jsonResponse } from "../http-utils";
import { handleParseCron } from "./configure";
export async function handleFlowTriggers(
	req: Request,
	url: URL,
): Promise<Response> {
	if (
		req.headers.has("origin") ||
		req.headers.get("sec-fetch-site") === "cross-site"
	)
		return errorResponse("Native clients only", 403);
	if (url.pathname === "/api/flows/triggers/status" && req.method === "GET")
		return jsonResponse(flowTriggerSourceStatus());
	if (url.pathname === "/api/flows/triggers/activity" && req.method === "GET")
		return jsonResponse({
			decisions: listTriggerDecisions(
				url.searchParams.get("flowId") ?? undefined,
			),
		});
	if (url.pathname === "/api/flows/triggers/catalog" && req.method === "GET")
		return jsonResponse({
			triggers: [
				{ type: "manual", name: "Manually" },
				{ type: "home.action", name: "Home Screen Action" },
				{ type: "dashboard.refresh", name: "Home refresh" },
				{ type: "schedule", name: "On a schedule" },
				...nativeTriggerCatalog.triggers,
			],
		});
	if (
		url.pathname === "/api/flows/triggers/parse-cron" &&
		req.method === "POST"
	)
		return handleParseCron(req);
	return errorResponse("Not found", 404);
}
