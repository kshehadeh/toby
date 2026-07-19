import "../../flows/index";
import { buildDefinitionSnapshot } from "../../flows/definition-snapshot";
import { listFlows } from "../../flows/registry";
import { getFlowRun, listFlowRuns } from "../../flows/store";
import { errorResponse, jsonResponse, parseIntParam } from "../http-utils";

/** GET /api/flows — stored flow definitions (metadata snapshot; seeds built-ins). */
export function handleFlowsList(): Response {
	const flows = listFlows().map((def) => buildDefinitionSnapshot(def));
	return jsonResponse({ flows });
}

/** GET /api/flows/runs?flowName=&limit=&offset= */
export function handleFlowRunsList(url: URL): Response {
	const flowName = url.searchParams.get("flowName")?.trim() || undefined;
	const limit = parseIntParam(url.searchParams.get("limit"), 50, 200);
	const offset = Math.max(
		0,
		Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
	);
	const runs = listFlowRuns({ flowName, limit, offset });
	return jsonResponse({ runs });
}

/** GET /api/flows/runs/:id */
export function handleFlowRunDetail(id: string): Response {
	const run = getFlowRun(id);
	if (!run) {
		return errorResponse("Flow run not found", 404);
	}
	return jsonResponse({ run, nodes: run.nodes });
}
