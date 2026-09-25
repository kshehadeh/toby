import { executeUserTool, executeUserToolById } from "../../user-tools/execute";
import {
	type UserToolDraft,
	deleteUserTool,
	getUserTool,
	listToolUses,
	listUserTools,
	saveUserTool,
	validateUserTool,
} from "../../user-tools/store";
import { errorResponse, jsonResponse, readJsonBody } from "../http-utils";

/** Prevent browser form posts and DNS-rebound pages from reaching code execution. */
export function rejectUnsafeUserToolRequest(req: Request): Response | null {
	const url = new URL(req.url);
	if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
		return errorResponse("Local host required", 403);
	}
	const origin = req.headers.get("origin");
	if (origin && origin !== url.origin) {
		return errorResponse("Cross-origin request denied", 403);
	}
	if (
		(req.method === "POST" || req.method === "PUT") &&
		!req.headers
			.get("content-type")
			?.toLowerCase()
			.startsWith("application/json")
	) {
		return errorResponse("Content-Type must be application/json", 415);
	}
	return null;
}

export function handleUserToolsList(): Response {
	return jsonResponse({
		tools: listUserTools().map((tool) => ({
			...tool,
			usedBy: listToolUses(tool.id),
		})),
	});
}

export function handleUserToolDetail(id: string): Response {
	const tool = getUserTool(id);
	return tool
		? jsonResponse({ tool: { ...tool, usedBy: listToolUses(id) } })
		: errorResponse("Tool not found", 404);
}

export async function handleUserToolSave(
	req: Request,
	id?: string,
): Promise<Response> {
	const body = await readJsonBody(req);
	if (!body) return errorResponse("Invalid JSON body", 400);
	try {
		const tool = saveUserTool(validateUserTool(body), id);
		return jsonResponse(
			{ tool: { ...tool, usedBy: listToolUses(tool.id) } },
			id ? 200 : 201,
		);
	} catch (error) {
		return errorResponse(
			error instanceof Error ? error.message : String(error),
			400,
		);
	}
}

export function handleUserToolDelete(id: string): Response {
	if (!getUserTool(id)) return errorResponse("Tool not found", 404);
	try {
		deleteUserTool(id);
		return jsonResponse({ ok: true });
	} catch (error) {
		return errorResponse(
			error instanceof Error ? error.message : String(error),
			409,
		);
	}
}

export async function handleUserToolTest(
	id: string,
	req: Request,
): Promise<Response> {
	if (!getUserTool(id)) return errorResponse("Tool not found", 404);
	const body = await readJsonBody(req);
	if (
		!body ||
		typeof body.input !== "object" ||
		body.input === null ||
		Array.isArray(body.input)
	) {
		return errorResponse("Input must be a JSON object", 400);
	}
	try {
		const { result, revision } = await executeUserToolById(
			id,
			body.input as Record<string, unknown>,
		);
		return jsonResponse({ ok: true, result, revision });
	} catch (error) {
		return jsonResponse({
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/** Run the editor's current code without creating or revising a library tool. */
export async function handleUserToolPreview(req: Request): Promise<Response> {
	const body = await readJsonBody(req);
	if (
		!body ||
		typeof body.input !== "object" ||
		body.input === null ||
		Array.isArray(body.input)
	) {
		return errorResponse("Input must be a JSON object", 400);
	}
	let draft: UserToolDraft;
	try {
		draft = validateUserTool({ ...body, name: "Preview", description: "" });
	} catch (error) {
		return errorResponse(
			error instanceof Error ? error.message : String(error),
			400,
		);
	}
	try {
		const result = await executeUserTool(
			draft,
			body.input as Record<string, unknown>,
		);
		return jsonResponse({ ok: true, result });
	} catch (error) {
		return jsonResponse({
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
