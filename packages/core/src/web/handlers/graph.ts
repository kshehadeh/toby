import { graphSnapshot } from "../../graph/snapshot";
import { GRAPH_NODE_TYPES, type GraphNodeType } from "../../graph/types";
import { errorResponse, jsonResponse } from "../http-utils";

const NODE_TYPES = new Set<string>(GRAPH_NODE_TYPES);

/** GET /api/graph?types=person,org&limit=200&collapse=1 */
export async function handleGraphSnapshot(
	req: Request,
	url: URL,
): Promise<Response> {
	if (req.method !== "GET") return errorResponse("Method not allowed", 405);
	const rawTypes = url.searchParams.get("types");
	const types = rawTypes
		?.split(",")
		.map((t) => t.trim())
		.filter((t): t is GraphNodeType => NODE_TYPES.has(t));
	if (rawTypes && types?.length === 0)
		return errorResponse("No valid node types", 400);
	const limit = Number(url.searchParams.get("limit"));
	return jsonResponse(
		graphSnapshot({
			types,
			limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
			collapseObservations: url.searchParams.get("collapse") !== "0",
		}),
	);
}
