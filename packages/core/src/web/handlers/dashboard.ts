import { getDashboardCategory, getDashboardData } from "../../dashboard";
import {
	getFlowDashboardContent,
	listFlowDashboardBlocks,
} from "../../dashboard/flow-blocks";
import { getDashboardBlockContent } from "../../dashboard/summarizer";
import { STANDARD_TOOL_FOR_CATEGORY } from "../../dashboard/types";
import { jsonResponse } from "../http-utils";

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
		const content = await getDashboardBlockContent(category, { force });
		return jsonResponse(content);
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
