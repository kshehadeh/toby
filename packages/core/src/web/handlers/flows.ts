import "../../flows/index";
import { buildDefinitionSnapshot } from "../../flows/definition-snapshot";
import { listFlowRecords } from "../../flows/definition-store";
import { hydrateFlowDocument } from "../../flows/hydrate";
import { getFlowRun, listFlowRuns } from "../../flows/store";
import { errorResponse, jsonResponse, parseIntParam } from "../http-utils";

/** GET /api/flows — stored flow definitions (metadata + graph; seeds built-ins). */
export function handleFlowsList(): Response {
	const flows = listFlowRecords().map((record) => {
		const def = hydrateFlowDocument(record.document);
		const snapshot = buildDefinitionSnapshot(def);
		return {
			id: record.id,
			name: record.name,
			description: record.description,
			builtin: record.builtin,
			persona: record.document.persona ?? { source: "default" as const },
			nodes: snapshot.nodes,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
		};
	});
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
