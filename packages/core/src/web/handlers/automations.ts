import { randomUUID } from "node:crypto";
import {
	deleteAutomation,
	getAutomation,
	getAutomationRun,
	listAutomationRuns,
	listAutomations,
	previewAutomation,
	saveAutomation,
} from "../../automations/store";
import { automationSourceStatus } from "../../automations/supervisor";
import {
	automationCatalog,
	automationEventSchema,
} from "../../automations/types";
import { errorResponse, jsonResponse } from "../http-utils";

export async function handleAutomations(
	req: Request,
	path: string,
): Promise<Response> {
	try {
		if (
			req.headers.has("origin") ||
			req.headers.get("sec-fetch-site") === "cross-site"
		)
			return errorResponse("Native clients only", 403);
		if (path === "/api/automations/catalog" && req.method === "GET")
			return jsonResponse(automationCatalog);
		if (path === "/api/automations/status" && req.method === "GET")
			return jsonResponse(automationSourceStatus());
		if (path === "/api/automations/runs" && req.method === "GET")
			return jsonResponse({
				runs: listAutomationRuns(
					new URL(req.url).searchParams.get("automationId") ?? undefined,
				),
			});
		const detail = /^\/api\/automations\/runs\/([^/]+)$/.exec(path);
		if (detail && req.method === "GET") {
			const run = getAutomationRun(decodeURIComponent(detail[1]));
			return run ? jsonResponse({ run }) : errorResponse("Run not found", 404);
		}
		if (path === "/api/automations") {
			if (req.method === "GET")
				return jsonResponse({ automations: listAutomations() });
			if (req.method === "POST")
				return jsonResponse(
					{ automation: saveAutomation(await req.json()) },
					201,
				);
		}
		const match = /^\/api\/automations\/([^/]+)(\/test)?$/.exec(path);
		if (!match) return errorResponse("Not found", 404);
		const id = decodeURIComponent(match[1]);
		const a = getAutomation(id);
		if (!a) return errorResponse("Automation not found", 404);
		if (match[2] && req.method === "POST") {
			const session = randomUUID();
			const value = (await req.json()) as { event?: unknown };
			const event = automationEventSchema.parse(
				value.event ?? {
					version: 1,
					id: `${session}:1`,
					source: "macos",
					type: a.trigger.type,
					occurredAt: new Date().toISOString(),
					observationSessionId: session,
					sequence: 1,
					payload:
						a.trigger.type === "macos.userReturned"
							? { idleSeconds: a.trigger.minimumIdleSeconds }
							: {},
				},
			);
			return jsonResponse(previewAutomation(a, event));
		}
		if (!match[2]) {
			if (req.method === "GET") return jsonResponse({ automation: a });
			if (req.method === "DELETE") {
				deleteAutomation(id);
				return jsonResponse({ ok: true });
			}
			if (req.method === "PATCH") {
				const { revision, ...draft } = (await req.json()) as Record<
					string,
					unknown
				>;
				return jsonResponse({
					automation: saveAutomation(draft, id, revision as number),
				});
			}
		}
		return errorResponse("Method not allowed", 405);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(
			message,
			message.includes("reload before saving") ? 409 : 400,
		);
	}
}
