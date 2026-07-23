import { clampLogLimit, queryUnifiedLog } from "../../logging/query";
import { jsonResponse, parseIntParam } from "../http-utils";

/**
 * GET /api/logs
 *
 * Query params: source, level, category, type, q, limit
 */
export function handleLogsList(url: URL): Response {
	const source = url.searchParams.get("source") ?? undefined;
	const level = url.searchParams.get("level") ?? undefined;
	const category = url.searchParams.get("category") ?? undefined;
	const type = url.searchParams.get("type") ?? undefined;
	const q = url.searchParams.get("q") ?? undefined;
	const limit = clampLogLimit(
		parseIntParam(url.searchParams.get("limit"), 100, 2000),
	);

	const result = queryUnifiedLog({
		source,
		level,
		category,
		type,
		q,
		limit,
	});

	return jsonResponse(result);
}
