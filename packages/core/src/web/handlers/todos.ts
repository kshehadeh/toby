import { z } from "zod";
import { coreFlowCatalog, executeCoreTool } from "../../core-tools";
import { todoReminderSchedule } from "../../todos/reminders";
import {
	getTodo,
	listOrganization,
	listTodos,
	todoHistory,
	todoHistoryEntries,
} from "../../todos/service";
import {
	reconcileRestoredTodos,
	runTodoSyncTick,
	todoSyncStatus,
} from "../../todos/sync";
import { TodoError } from "../../todos/types";
import { jsonResponse, readJsonBody } from "../http-utils";

export async function handleTodos(req: Request, url: URL): Promise<Response> {
	try {
		const suffix = url.pathname.slice("/api/todos".length);
		if (suffix === "/reminders/schedule" && req.method === "GET")
			return jsonResponse(todoReminderSchedule());
		if (suffix === "/sync" && req.method === "GET")
			return jsonResponse(todoSyncStatus());
		if (suffix === "/sync" && req.method === "POST")
			return jsonResponse({
				result: await runTodoSyncTick(),
				...todoSyncStatus(),
			});
		if (suffix === "/reconcile" && req.method === "POST") {
			const body = await readJsonBody<Record<string, unknown>>(req);
			if (body?.confirmMerge !== true)
				throw new TodoError(
					"confirmation_required",
					"Review the restored todos and confirm merging with the sync destination.",
				);
			reconcileRestoredTodos();
			return jsonResponse(todoSyncStatus());
		}
		if (suffix === "/tools" && req.method === "GET")
			return jsonResponse({ tools: await coreFlowCatalog() });
		if (suffix.startsWith("/actions/") && req.method === "POST") {
			const action = decodeURIComponent(suffix.slice("/actions/".length));
			const body = await readJsonBody<Record<string, unknown>>(req);
			return jsonResponse({
				result: executeCoreTool(`todos.${action}`, body, {
					source: "api",
					idempotencyKey: req.headers.get("Idempotency-Key") ?? undefined,
					expectedRevision: req.headers.get("If-Match") ?? undefined,
				}),
			});
		}
		if ((suffix === "/lists" || suffix === "/tags") && req.method === "GET")
			return jsonResponse({
				items: listOrganization(suffix === "/lists" ? "list" : "tag"),
			});
		if (!suffix && req.method === "GET") {
			const input: Record<string, unknown> = Object.fromEntries(
				url.searchParams,
			);
			for (const key of ["limit", "offset"])
				if (input[key] !== undefined) input[key] = Number(input[key]);
			return jsonResponse(listTodos(input));
		}
		const match = /^\/([^/]+)(\/history)?$/.exec(suffix);
		if (match && req.method === "GET") {
			const id = decodeURIComponent(match[1]);
			return jsonResponse(
				match[2]
					? { history: todoHistory(id), entries: todoHistoryEntries(id) }
					: {
							todo: getTodo(
								id,
								url.searchParams.has("sequence")
									? z.coerce
											.number()
											.int()
											.nonnegative()
											.parse(url.searchParams.get("sequence"))
									: undefined,
							),
						},
			);
		}
		return jsonResponse({ error: "Not found" }, 404);
	} catch (error) {
		return jsonResponse(
			{
				error: error instanceof Error ? error.message : "Todo request failed",
				code: error instanceof TodoError ? error.code : "invalid_input",
				...(error instanceof z.ZodError ? { issues: error.issues } : {}),
			},
			error instanceof TodoError ? error.status : 400,
		);
	}
}
