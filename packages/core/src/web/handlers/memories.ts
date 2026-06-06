import * as memory from "../../memory/memory-service";
import { errorResponse, jsonResponse, parseIntParam } from "../http-utils";

const DEFAULT_USER_ID = "default";

export function handleMemoriesList(url: URL): Response {
	const query = url.searchParams.get("q") ?? undefined;
	const limit = parseIntParam(url.searchParams.get("limit"), 50, 500);
	const offset = Math.max(
		0,
		Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
	);
	const items = memory.listMemoryItems(DEFAULT_USER_ID, {
		query,
		limit,
		offset,
	});
	return jsonResponse({ memories: items, limit, offset });
}

export function handleMemoryDetail(memoryId: string): Response {
	const item = memory.get(DEFAULT_USER_ID, memoryId);
	if (!item) {
		return errorResponse("Memory not found", 404);
	}
	return jsonResponse({ memory: item });
}

export function handleMemoryExplain(memoryId: string): Response {
	const item = memory.get(DEFAULT_USER_ID, memoryId);
	if (!item) {
		return errorResponse("Memory not found", 404);
	}
	const explanation = memory.explain(DEFAULT_USER_ID, memoryId);
	return jsonResponse({ explanation });
}
