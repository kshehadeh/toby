import { randomUUID } from "node:crypto";
import "../../flows/index";
import {
	catalogConnectedNames,
	catalogToolsList,
	listFlowToolCatalog,
} from "../../flows/catalog";
import { buildDefinitionSnapshot } from "../../flows/definition-snapshot";
import {
	deleteUserFlowDocument,
	getFlowRecord,
	listFlowRecords,
	saveUserFlowDocument,
} from "../../flows/definition-store";
import type { StoredFlowRecord } from "../../flows/document-types";
import { hydrateFlowDocument } from "../../flows/hydrate";
import { parseUserFlowDocumentBody } from "../../flows/parse-user-flow";
import { runUserFlowById } from "../../flows/run-user-flow";
import { getFlowRun, listFlowRuns } from "../../flows/store";
import {
	UserFlowValidationError,
	validateUserFlowDocument,
} from "../../flows/validate-user-flow";
import {
	errorResponse,
	jsonResponse,
	parseIntParam,
	readJsonBody,
} from "../http-utils";

function serializeFlowRecord(record: StoredFlowRecord) {
	const def = hydrateFlowDocument(record.document);
	const snapshot = buildDefinitionSnapshot(def);
	return {
		id: record.id,
		name: record.name,
		description: record.description,
		icon: record.document.icon ?? null,
		builtin: record.builtin,
		persona: record.document.persona ?? { source: "default" as const },
		nodes: snapshot.nodes,
		result: record.document.result ?? null,
		destinations: record.document.destinations ?? [],
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

/** GET /api/flows — stored flow definitions (metadata + graph; seeds built-ins). */
export function handleFlowsList(): Response {
	const flows = listFlowRecords().map(serializeFlowRecord);
	return jsonResponse({ flows });
}

/** GET /api/flows/catalog — connected plugin tools including inputSchema. */
export async function handleFlowsCatalog(): Promise<Response> {
	const catalog = await listFlowToolCatalog();
	return jsonResponse(catalog);
}

async function validatedUserDocument(
	body: Record<string, unknown>,
	id: string,
) {
	const catalog = await listFlowToolCatalog();
	const parsed = parseUserFlowDocumentBody(body, id);
	return validateUserFlowDocument(parsed, {
		tools: catalogToolsList(catalog),
		connectedModules: catalogConnectedNames(catalog),
	});
}

/** POST /api/flows — create a custom flow. */
export async function handleFlowCreate(req: Request): Promise<Response> {
	const body = await readJsonBody(req);
	if (!body) {
		return errorResponse("Invalid JSON body", 400);
	}
	const id = `flow.${randomUUID()}`;
	try {
		const document = await validatedUserDocument(body, id);
		const record = saveUserFlowDocument(document);
		return jsonResponse(
			{ flow: serializeFlowRecord(record), document: record.document },
			201,
		);
	} catch (error) {
		if (error instanceof UserFlowValidationError) {
			return jsonResponse({ error: error.message, issues: error.issues }, 400);
		}
		return errorResponse(
			error instanceof Error ? error.message : String(error),
			400,
		);
	}
}

/** GET /api/flows/:id — one definition plus the stored document (for the editor). */
export function handleFlowDetail(id: string): Response {
	const existing = getFlowRecord(id);
	if (!existing) {
		return errorResponse("Flow not found", 404);
	}
	return jsonResponse({
		flow: serializeFlowRecord(existing),
		document: existing.document,
	});
}

/** PUT /api/flows/:id — replace a custom flow. */
export async function handleFlowUpdate(
	id: string,
	req: Request,
): Promise<Response> {
	const existing = getFlowRecord(id);
	if (!existing) {
		return errorResponse("Flow not found", 404);
	}
	if (existing.builtin) {
		return errorResponse("Built-in flows can’t be edited", 403);
	}
	const body = await readJsonBody(req);
	if (!body) {
		return errorResponse("Invalid JSON body", 400);
	}
	try {
		const document = await validatedUserDocument(body, existing.id);
		const record = saveUserFlowDocument(document);
		return jsonResponse({
			flow: serializeFlowRecord(record),
			document: record.document,
		});
	} catch (error) {
		if (error instanceof UserFlowValidationError) {
			return jsonResponse({ error: error.message, issues: error.issues }, 400);
		}
		return errorResponse(
			error instanceof Error ? error.message : String(error),
			400,
		);
	}
}

/** DELETE /api/flows/:id — delete a custom flow. */
export function handleFlowDelete(id: string): Response {
	const existing = getFlowRecord(id);
	if (!existing) {
		return errorResponse("Flow not found", 404);
	}
	try {
		deleteUserFlowDocument(id);
		return jsonResponse({ ok: true });
	} catch (error) {
		return errorResponse(
			error instanceof Error ? error.message : String(error),
			403,
		);
	}
}

/** POST /api/flows/:id/run — run now (interactive). */
export async function handleFlowRun(id: string): Promise<Response> {
	const existing = getFlowRecord(id);
	if (!existing) {
		return errorResponse("Flow not found", 404);
	}
	const result = await runUserFlowById(id, { trigger: "ui" });
	return jsonResponse({
		ok: result.ok,
		runId: result.runId ?? null,
		error: result.ok ? null : result.error,
		failedNodeId: result.ok ? null : (result.failedNodeId ?? null),
		result: result.extracted,
		destinations: result.destinations,
	});
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
