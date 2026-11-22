import { z } from "zod";
import { readConfig, writeConfig } from "../../config/index";
import type { FollowupsConfig, TobyConfig } from "../../config/index";
import { explainTobyFollowup } from "../../followups/explain";
import {
	recordFollowupNotUseful,
	reopenFollowupTodo,
	runFollowupsOnce,
} from "../../followups/scheduler";
import {
	deleteFollowupInstruction,
	findFollowupByTodoId,
	getFollowupLoop,
	listFollowupInstructions,
	listFollowupLoops,
	saveFollowupInstruction,
} from "../../followups/store";
import { isNodeVisible, neighbors } from "../../graph/query";
import { rebuildGraph } from "../../graph/rebuild";
import { getNode } from "../../graph/store";
import { isSourceEnabled } from "../../observations/run";
import { listObservationSources } from "../../observations/sources";
import { getCursor } from "../../observations/store";
import { errorResponse, jsonResponse, readJsonBody } from "../http-utils";

const configSchema = z
	.object({
		followups: z
			.object({
				enabled: z.boolean().optional(),
				evaluator: z
					.object({
						provider: z.string().nullable().optional(),
						model: z.string().nullable().optional(),
					})
					.partial()
					.optional(),
				sources: z.record(z.boolean()).optional(),
				kinds: z
					.object({
						oweReply: z.boolean().optional(),
						awaitingReply: z.boolean().optional(),
						commitment: z.boolean().optional(),
					})
					.partial()
					.optional(),
				awaitingReplyDays: z.number().int().min(0).max(30).optional(),
				thresholds: z
					.object({
						open: z.number().min(0).max(1).optional(),
						close: z.number().min(0).max(1).optional(),
					})
					.partial()
					.optional(),
				autoComplete: z.boolean().optional(),
				notifications: z.boolean().optional(),
				intervalMinutes: z.number().int().min(5).max(1440).optional(),
				maxEvaluationsPerDay: z.number().int().min(1).max(5000).optional(),
			})
			.partial()
			.optional(),
		graph: z
			.object({
				semanticThreshold: z.number().min(0).max(1).optional(),
				maxExtractionsPerDay: z.number().int().min(0).max(10000).optional(),
			})
			.partial()
			.optional(),
	})
	.strict();

const INSTRUCTIONS_PREFIX = "/api/followups/instructions";

function compactFollowupsConfig(
	config: FollowupsConfig,
	sourceDefaults: ReadonlyMap<string, boolean>,
): FollowupsConfig | undefined {
	const nested = new Set(["evaluator", "sources", "kinds", "thresholds"]);
	const compact = omitDefaults(
		Object.fromEntries(
			Object.entries(config).filter(([key]) => !nested.has(key)),
		),
		{
			enabled: true,
			awaitingReplyDays: 3,
			autoComplete: true,
			notifications: true,
			intervalMinutes: 30,
			maxEvaluationsPerDay: 200,
		},
	);

	if (config.evaluator) {
		const evaluator = Object.fromEntries(
			Object.entries(config.evaluator).filter(([, value]) => value != null),
		);
		if (Object.keys(evaluator).length) compact.evaluator = evaluator;
	}

	if (config.sources) {
		const sources = Object.fromEntries(
			Object.entries(config.sources).filter(
				([id, enabled]) => enabled !== (sourceDefaults.get(id) ?? true),
			),
		);
		if (Object.keys(sources).length) compact.sources = sources;
	}

	if (config.kinds) {
		const kinds = omitDefaults(config.kinds, {
			oweReply: true,
			awaitingReply: true,
			commitment: true,
		});
		if (Object.keys(kinds).length) compact.kinds = kinds;
	}

	if (config.thresholds) {
		const thresholds = omitDefaults(config.thresholds, {
			open: 0.75,
			close: 0.85,
		});
		if (Object.keys(thresholds).length) compact.thresholds = thresholds;
	}

	return Object.keys(compact).length ? (compact as FollowupsConfig) : undefined;
}

function omitDefaults(
	values: Readonly<Record<string, unknown>>,
	defaults: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(values).filter(
			([key, value]) =>
				value !== undefined &&
				(!Object.hasOwn(defaults, key) || value !== defaults[key]),
		),
	);
}

function compactGraphConfig(config: TobyConfig["graph"]): TobyConfig["graph"] {
	if (!config) return undefined;
	const compact = omitDefaults(
		{ ...config },
		{
			semanticThreshold: 0.8,
			maxExtractionsPerDay: 300,
		},
	);
	return Object.keys(compact).length ? compact : undefined;
}

function resolveLoop(id: string) {
	return getFollowupLoop(id) ?? findFollowupByTodoId(id);
}

export async function handleFollowups(
	req: Request,
	url: URL,
): Promise<Response> {
	const path = url.pathname;
	if (path === "/api/followups/config") {
		if (req.method === "GET")
			return jsonResponse({
				followups: readConfig().followups ?? {},
				graph: readConfig().graph ?? {},
			});
		if (req.method === "PUT" || req.method === "PATCH") {
			const parsed = configSchema.safeParse(
				await readJsonBody<Record<string, unknown>>(req),
			);
			if (!parsed.success)
				return errorResponse(
					parsed.error.issues[0]?.message ?? "Invalid follow-up settings.",
				);
			const config = readConfig();
			const incoming = parsed.data;
			const evaluator = incoming.followups?.evaluator;
			const mergedFollowups = incoming.followups
				? ({
						...config.followups,
						...incoming.followups,
						...(req.method === "PATCH"
							? {
									...(incoming.followups.sources
										? {
												sources: {
													...config.followups?.sources,
													...incoming.followups.sources,
												},
											}
										: {}),
									...(incoming.followups.kinds
										? {
												kinds: {
													...config.followups?.kinds,
													...incoming.followups.kinds,
												},
											}
										: {}),
									...(incoming.followups.thresholds
										? {
												thresholds: {
													...config.followups?.thresholds,
													...incoming.followups.thresholds,
												},
											}
										: {}),
								}
							: {}),
						...(evaluator
							? {
									evaluator: {
										...config.followups?.evaluator,
										...(evaluator.provider !== undefined
											? { provider: evaluator.provider ?? undefined }
											: {}),
										...(evaluator.model !== undefined
											? { model: evaluator.model ?? undefined }
											: {}),
									},
								}
							: {}),
					} as FollowupsConfig)
				: config.followups;
			const sourceDefaults = new Map(
				(await listObservationSources()).map((source) => [
					source.id,
					source.defaultEnabled,
				]),
			);
			const nextFollowups =
				incoming.followups && mergedFollowups
					? compactFollowupsConfig(mergedFollowups, sourceDefaults)
					: mergedFollowups;
			const mergedGraph = incoming.graph
				? { ...config.graph, ...incoming.graph }
				: config.graph;
			const nextGraph = incoming.graph
				? compactGraphConfig(mergedGraph)
				: mergedGraph;
			const next: TobyConfig = {
				...config,
				followups: nextFollowups,
				graph: nextGraph,
			};
			writeConfig(next);
			return jsonResponse({
				followups: next.followups ?? {},
				graph: next.graph ?? {},
			});
		}
		return errorResponse("Method not allowed", 405);
	}
	if (path === "/api/followups/sources" && req.method === "GET") {
		const sources = await listObservationSources();
		return jsonResponse({
			sources: sources.map((source) => ({
				id: source.id,
				displayName: source.displayName,
				origin: source.origin,
				evidenceOnly: source.evidenceOnly ?? false,
				defaultEnabled: source.defaultEnabled,
				enabled: isSourceEnabled(source),
				cursor: getCursor(source.id),
			})),
		});
	}
	if (path === "/api/followups/run" && req.method === "POST") {
		return jsonResponse(await runFollowupsOnce());
	}
	if (path === "/api/followups" && req.method === "GET") {
		return jsonResponse({ loops: listFollowupLoops({ limit: 500 }) });
	}
	if (
		path === INSTRUCTIONS_PREFIX ||
		path.startsWith(`${INSTRUCTIONS_PREFIX}/`)
	) {
		return handleInstructions(req, path);
	}
	const feedback = /^\/api\/followups\/([^/]+)\/(feedback|reopen)$/.exec(path);
	if (feedback) {
		const id = decodeURIComponent(feedback[1] ?? "");
		const loop = resolveLoop(id);
		if (!loop) return errorResponse("Follow-up not found", 404);
		if (feedback[2] === "reopen" && req.method === "POST") {
			if (!reopenFollowupTodo(loop.loopId))
				return errorResponse("Todo is not completed", 409);
			return jsonResponse({ ok: true, loop: getFollowupLoop(loop.loopId) });
		}
		if (feedback[2] === "feedback" && req.method === "POST") {
			const body = await readJsonBody<{ outcome?: unknown }>(req);
			if (body?.outcome !== "not_useful")
				return errorResponse("outcome must be not_useful");
			if (!recordFollowupNotUseful(loop.loopId))
				return errorResponse("Could not update follow-up", 409);
			return jsonResponse({ ok: true });
		}
		return errorResponse("Method not allowed", 405);
	}
	const detail = /^\/api\/followups\/([^/]+)$/.exec(path);
	if (detail && req.method === "GET") {
		const id = decodeURIComponent(detail[1] ?? "");
		const loop = resolveLoop(id);
		if (!loop) return errorResponse("Follow-up not found", 404);
		return jsonResponse({
			...loop,
			evidence: explainTobyFollowup(loop.todoId ?? "")?.evidence ?? [],
		});
	}
	return errorResponse("Not found", 404);
}

async function handleInstructions(
	req: Request,
	path: string,
): Promise<Response> {
	const rest = path.slice(INSTRUCTIONS_PREFIX.length);
	const id = rest.startsWith("/") ? decodeURIComponent(rest.slice(1)) : "";
	if (rest && !id) return errorResponse("Not found", 404);
	if (!id) {
		if (req.method === "GET")
			return jsonResponse({ instructions: listFollowupInstructions() });
		if (req.method === "POST") {
			const body = await readJsonBody<{ text?: unknown }>(req);
			if (typeof body?.text !== "string" || !body.text.trim())
				return errorResponse("text is required");
			if (body.text.length > 2000)
				return errorResponse("text must be 2000 characters or fewer");
			if (listFollowupInstructions().length >= 20)
				return errorResponse("You can keep up to 20 instructions.");
			return jsonResponse(
				{
					instruction: saveFollowupInstruction({ text: body.text }),
					instructions: listFollowupInstructions(),
				},
				201,
			);
		}
		return errorResponse("Method not allowed", 405);
	}
	const exists = listFollowupInstructions().some(
		(instruction) => instruction.id === id,
	);
	if (!exists) return errorResponse("Instruction not found", 404);
	if (req.method === "PATCH") {
		const body = await readJsonBody<{ text?: unknown }>(req);
		if (
			typeof body?.text !== "string" ||
			!body.text.trim() ||
			body.text.length > 2000
		)
			return errorResponse("text must be 1–2000 characters");
		saveFollowupInstruction({ id, text: body.text });
		return jsonResponse({ instructions: listFollowupInstructions() });
	}
	if (req.method === "DELETE") {
		deleteFollowupInstruction(id);
		return jsonResponse({ instructions: listFollowupInstructions() });
	}
	return errorResponse("Method not allowed", 405);
}

export async function handleGraphNeighbors(
	req: Request,
	nodeId: string,
	url: URL,
): Promise<Response> {
	if (req.method !== "GET") return errorResponse("Method not allowed", 405);
	const node = getNode(nodeId);
	if (!node || !isNodeVisible(node))
		return errorResponse("Graph node not found", 404);
	const depth = Math.min(
		3,
		Math.max(1, Number(url.searchParams.get("depth")) || 2),
	);
	const limit = Math.min(
		500,
		Math.max(1, Number(url.searchParams.get("limit")) || 100),
	);
	return jsonResponse({ node, neighbors: neighbors(nodeId, { depth, limit }) });
}

export async function handleGraphRebuild(req: Request): Promise<Response> {
	if (req.method !== "POST") return errorResponse("Method not allowed", 405);
	return jsonResponse({ ok: true, ...rebuildGraph() });
}
