import * as memory from "../../memory/memory-service";
import {
	MemorySensitivityValues,
	MemoryTypeValues,
	MemoryVisibilityValues,
} from "../../memory/types";
import {
	errorResponse,
	jsonResponse,
	parseIntParam,
	readJsonBody,
} from "../http-utils";

const DEFAULT_USER_ID = "default";

const VALID_TYPES = new Set<string>(MemoryTypeValues);
const VALID_SENSITIVITIES = new Set<string>(MemorySensitivityValues);
const VALID_VISIBILITIES = new Set<string>(MemoryVisibilityValues);

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
	const total = memory.countMemoryItems(DEFAULT_USER_ID, { query });
	return jsonResponse({
		memories: items,
		limit,
		offset,
		total,
		hasMore: offset + items.length < total,
	});
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

export async function handleMemoryCreate(req: Request): Promise<Response> {
	const body = await readJsonBody<Record<string, unknown>>(req);
	if (!body) {
		return errorResponse("Invalid JSON body", 400);
	}
	const value = typeof body.value === "string" ? body.value.trim() : "";
	if (!value) {
		return errorResponse("Body must include a non-empty 'value' field", 400);
	}
	const type = typeof body.type === "string" ? body.type : "fact";
	if (!VALID_TYPES.has(type)) {
		return errorResponse(
			`Invalid 'type'. Must be one of: ${[...VALID_TYPES].join(", ")}`,
			400,
		);
	}
	const sensitivity =
		typeof body.sensitivity === "string" ? body.sensitivity : "normal";
	if (!VALID_SENSITIVITIES.has(sensitivity)) {
		return errorResponse(
			`Invalid 'sensitivity'. Must be one of: ${[...VALID_SENSITIVITIES].join(", ")}`,
			400,
		);
	}
	const visibility =
		typeof body.visibility === "string" ? body.visibility : "usable_by_ai";
	if (!VALID_VISIBILITIES.has(visibility)) {
		return errorResponse(
			`Invalid 'visibility'. Must be one of: ${[...VALID_VISIBILITIES].join(", ")}`,
			400,
		);
	}
	const subject =
		typeof body.subject === "string" ? body.subject.trim() : undefined;
	const confidence =
		typeof body.confidence === "number" && Number.isFinite(body.confidence)
			? Math.max(0, Math.min(1, body.confidence))
			: 1;
	const expiresAt =
		typeof body.expiresAt === "string"
			? body.expiresAt
			: body.expiresAt === null
				? null
				: undefined;

	try {
		const item = memory.createManual(DEFAULT_USER_ID, {
			type: type as memory.ManualMemoryInput["type"],
			subject,
			value,
			confidence,
			sensitivity: sensitivity as memory.ManualMemoryInput["sensitivity"],
			visibility: visibility as memory.ManualMemoryInput["visibility"],
			expiresAt,
		});
		return jsonResponse({ memory: item }, 201);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 500);
	}
}

export async function handleMemoryPatch(
	memoryId: string,
	req: Request,
): Promise<Response> {
	const body = await readJsonBody<Record<string, unknown>>(req);
	if (!body) {
		return errorResponse("Invalid JSON body", 400);
	}
	const patch: Record<string, unknown> = {};
	if (typeof body.value === "string") {
		const value = body.value.trim();
		if (!value) {
			return errorResponse("'value' must be non-empty", 400);
		}
		patch.value = value;
	}
	if (typeof body.subject === "string") {
		patch.subject = body.subject.trim();
	}
	if (typeof body.type === "string") {
		if (!VALID_TYPES.has(body.type)) {
			return errorResponse(
				`Invalid 'type'. Must be one of: ${[...VALID_TYPES].join(", ")}`,
				400,
			);
		}
		patch.type = body.type;
	}
	if (typeof body.sensitivity === "string") {
		if (!VALID_SENSITIVITIES.has(body.sensitivity)) {
			return errorResponse(
				`Invalid 'sensitivity'. Must be one of: ${[...VALID_SENSITIVITIES].join(", ")}`,
				400,
			);
		}
		patch.sensitivity = body.sensitivity;
	}
	if (typeof body.visibility === "string") {
		if (!VALID_VISIBILITIES.has(body.visibility)) {
			return errorResponse(
				`Invalid 'visibility'. Must be one of: ${[...VALID_VISIBILITIES].join(", ")}`,
				400,
			);
		}
		patch.visibility = body.visibility;
	}
	if (typeof body.confidence === "number" && Number.isFinite(body.confidence)) {
		patch.confidence = Math.max(0, Math.min(1, body.confidence));
	}
	if (typeof body.expiresAt === "string" || body.expiresAt === null) {
		patch.expiresAt = body.expiresAt;
	}

	if (Object.keys(patch).length === 0) {
		return errorResponse(
			"Body must include at least one updatable field (value, subject, type, sensitivity, visibility, confidence, expiresAt)",
			400,
		);
	}

	const existing = memory.get(DEFAULT_USER_ID, memoryId);
	if (!existing) {
		return errorResponse("Memory not found", 404);
	}

	try {
		const updated = memory.update(DEFAULT_USER_ID, memoryId, patch as never);
		return jsonResponse({ memory: updated });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 500);
	}
}

export function handleMemoryDelete(memoryId: string): Response {
	const existing = memory.get(DEFAULT_USER_ID, memoryId);
	if (!existing) {
		return errorResponse("Memory not found", 404);
	}
	try {
		memory.forget(DEFAULT_USER_ID, memoryId);
		return jsonResponse({ ok: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 500);
	}
}
