import { GatewayFundsError } from "../../ai/gateway-funds";
import { getDashboardCategory, getDashboardData } from "../../dashboard";
import { listFlowDashboardBlocks } from "../../dashboard/flow-blocks";
import { STANDARD_TOOL_FOR_CATEGORY } from "../../dashboard/types";
import { performFeedAction } from "../../feed/execute";
import {
	compileFeedInstructionRules,
	findFeedItem,
	getFeedContent,
	getPersistedFeed,
} from "../../feed/index";
import { instructionRuleHash } from "../../feed/instruction-filters";
import {
	FEED_INSTRUCTIONS_MAX,
	type FeedInstruction,
	type FeedState,
	addInstruction,
	applyFeedState,
	loadFeedState,
	normalizeInstructionText,
	removeInstruction,
	setInstructionEnabled,
	updateFeedState,
} from "../../feed/state";
import { errorResponse, jsonResponse, readJsonBody } from "../http-utils";

/** True when the client asked for a cache-bypassing refresh (`?fresh=1`). */
function isFreshRequest(url?: URL): boolean {
	if (!url) return false;
	const raw = url.searchParams.get("fresh");
	return raw === "1" || raw === "true";
}

export async function handleDashboard(): Promise<Response> {
	const data = await getDashboardData();
	return jsonResponse(data);
}

/** GET /api/dashboard/flow-blocks — custom flows shown as Home Actions. */
export function handleDashboardFlowBlocks(): Response {
	return jsonResponse({ blocks: listFlowDashboardBlocks() });
}

/** Aggregator list/count payload (internal / debug; The Feed reads it in-process). */
export async function handleDashboardCategory(
	category: string,
	url?: URL,
): Promise<Response> {
	if (
		!Object.prototype.hasOwnProperty.call(STANDARD_TOOL_FOR_CATEGORY, category)
	) {
		return jsonResponse(
			{ error: `Unknown dashboard category: ${category}` },
			404,
		);
	}
	const force = isFreshRequest(url);
	const data = await getDashboardCategory(category, { force });
	return jsonResponse(data);
}

/**
 * GET /api/dashboard/feed — The Feed (ranked items with reasons + actions).
 * `?fresh=1` re-collects and re-ranks. 402 when the AI gateway is out of funds.
 */
export async function handleDashboardFeed(url?: URL): Promise<Response> {
	try {
		const content = await getFeedContent({
			force: isFreshRequest(url),
			trigger: "dashboard.feed:api",
		});
		return jsonResponse(content);
	} catch (error) {
		if (error instanceof GatewayFundsError) {
			return jsonResponse(error.toBody(), 402);
		}
		throw error;
	}
}

/**
 * POST /api/dashboard/feed/actions `{ itemId, actionId }` — run a Feed `tool`
 * or `local` action. Responds with the outcome plus the current (state
 * filtered) Feed so the client can update without re-ranking.
 */
export async function handleDashboardFeedAction(
	req: Request,
): Promise<Response> {
	const body = await readJsonBody<{ itemId?: unknown; actionId?: unknown }>(
		req,
	);
	const itemId = typeof body?.itemId === "string" ? body.itemId.trim() : "";
	const actionId =
		typeof body?.actionId === "string" ? body.actionId.trim() : "";
	if (!itemId || !actionId) {
		return errorResponse("itemId and actionId are required.");
	}
	const outcome = await performFeedAction(
		{ itemId, actionId },
		{
			findItem: findFeedItem,
		},
	);
	if (!outcome.ok) {
		return jsonResponse({ ok: false, error: outcome.error }, outcome.status);
	}
	const now = new Date();
	const persisted = getPersistedFeed();
	return jsonResponse({
		ok: true,
		message: outcome.message,
		...(outcome.todoId ? { todoId: outcome.todoId } : {}),
		...(persisted
			? { content: applyFeedState(persisted, loadFeedState(now), now) }
			: {}),
	});
}

const INSTRUCTIONS_PREFIX = "/api/dashboard/feed/instructions";

/**
 * How an instruction is enforced, for the instructions sheet:
 * - `filter`   — compiled into a filter applied in code (`enforcementSummary`)
 * - `guidance` — sent to the ranker only (ordering, emphasis)
 * - `pending`  — not compiled yet (or the last attempt failed)
 */
export function instructionEnforcement(instruction: FeedInstruction): {
	readonly enforcement: "filter" | "guidance" | "pending";
	readonly enforcementSummary?: string;
} {
	const rule = instruction.rule;
	if (!rule || rule.hash !== instructionRuleHash(instruction.text))
		return { enforcement: "pending" };
	if (rule.status === "filter")
		return { enforcement: "filter", enforcementSummary: rule.summary };
	if (rule.status === "guidance") return { enforcement: "guidance" };
	return { enforcement: "pending" };
}

function instructionsBody(state: FeedState) {
	return {
		instructions: state.instructions.map(({ rule: _rule, ...instruction }) => ({
			...instruction,
			...instructionEnforcement({
				...instruction,
				...(_rule ? { rule: _rule } : {}),
			}),
		})),
	};
}

/**
 * `/api/dashboard/feed/instructions[/:id]` — the user's guidance for what The
 * Feed includes and how it ranks. Changes alter the personalization signature,
 * so the next Feed load re-ranks.
 *
 * - `GET`            → `{ instructions }`
 * - `POST { text }`  → adds one (201)
 * - `PATCH /:id { enabled }` → turns one on or off
 * - `DELETE /:id`    → removes one
 */
export async function handleDashboardFeedInstructions(
	req: Request,
	pathname: string,
): Promise<Response> {
	const rest = pathname.slice(INSTRUCTIONS_PREFIX.length);
	const id = rest.startsWith("/") ? decodeURIComponent(rest.slice(1)) : "";
	if (rest && !id) return errorResponse("Not found", 404);

	if (!id) {
		if (req.method === "GET") {
			return jsonResponse(instructionsBody(loadFeedState()));
		}
		if (req.method === "POST") {
			const body = await readJsonBody<{ text?: unknown }>(req);
			const parsed = normalizeInstructionText(body?.text);
			if (!parsed.ok) return errorResponse(parsed.error);
			if (loadFeedState().instructions.length >= FEED_INSTRUCTIONS_MAX) {
				return errorResponse(
					`You can keep up to ${FEED_INSTRUCTIONS_MAX} instructions. Delete one first.`,
				);
			}
			const now = new Date();
			const next = updateFeedState(
				(s) => addInstruction(s, parsed.text, now),
				now,
			);
			void compileFeedInstructionRules();
			return jsonResponse(instructionsBody(next), 201);
		}
		return errorResponse("Method not allowed", 405);
	}

	const exists = loadFeedState().instructions.some((i) => i.id === id);
	if (!exists) return errorResponse("Instruction not found", 404);
	if (req.method === "PATCH") {
		const body = await readJsonBody<{ enabled?: unknown }>(req);
		if (typeof body?.enabled !== "boolean") {
			return errorResponse("enabled (boolean) is required.");
		}
		const enabled = body.enabled;
		const next = updateFeedState((s) => setInstructionEnabled(s, id, enabled));
		if (enabled) void compileFeedInstructionRules();
		return jsonResponse(instructionsBody(next));
	}
	if (req.method === "DELETE") {
		const next = updateFeedState((s) => removeInstruction(s, id));
		return jsonResponse(instructionsBody(next));
	}
	return errorResponse("Method not allowed", 405);
}
