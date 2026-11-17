import { GatewayFundsError } from "../../ai/gateway-funds";
import { getDashboardCategory, getDashboardData } from "../../dashboard";
import {
	getFlowDashboardContent,
	listFlowDashboardBlocks,
} from "../../dashboard/flow-blocks";
import { getDashboardBlockContent } from "../../dashboard/summarizer";
import { STANDARD_TOOL_FOR_CATEGORY } from "../../dashboard/types";
import { performFeedAction } from "../../feed/execute";
import { getFeedContent, getPersistedFeed } from "../../feed/index";
import { applyFeedState, loadFeedState } from "../../feed/state";
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

/** GET /api/dashboard/flow-blocks — custom flows opted onto the home screen. */
export function handleDashboardFlowBlocks(): Response {
	return jsonResponse({ blocks: listFlowDashboardBlocks() });
}

/**
 * Aggregator list/count payload (internal / debug). Home cards use block content.
 */
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
 * Home-dashboard block content (flow output). Single path for card bodies.
 * Aliases: `…/summary` (legacy) and `…/content`.
 */
export async function handleDashboardBlockContent(
	category: string,
	url?: URL,
): Promise<Response> {
	const force = isFreshRequest(url);
	if (
		Object.prototype.hasOwnProperty.call(STANDARD_TOOL_FOR_CATEGORY, category)
	) {
		try {
			const content = await getDashboardBlockContent(category, { force });
			return jsonResponse(content);
		} catch (error) {
			if (error instanceof GatewayFundsError) {
				return jsonResponse(error.toBody(), 402);
			}
			throw error;
		}
	}
	const flowContent = await getFlowDashboardContent(category, { force });
	if (!flowContent) {
		return jsonResponse(
			{ error: `Unknown dashboard category: ${category}` },
			404,
		);
	}
	return jsonResponse(flowContent);
}

/** @deprecated Prefer {@link handleDashboardBlockContent}. */
export async function handleDashboardCategorySummary(
	category: string,
	url?: URL,
): Promise<Response> {
	return handleDashboardBlockContent(category, url);
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
			findItem: (id) => getPersistedFeed()?.items.find((i) => i.id === id),
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
