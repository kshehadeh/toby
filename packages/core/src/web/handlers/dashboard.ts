import { getDashboardCategory, getDashboardData } from "../../dashboard";
import { STANDARD_TOOL_FOR_CATEGORY } from "../../dashboard/types";
import { jsonResponse } from "../http-utils";

export async function handleDashboard(): Promise<Response> {
	const data = await getDashboardData();
	return jsonResponse(data);
}

export async function handleDashboardCategory(
	category: string,
): Promise<Response> {
	if (
		!Object.prototype.hasOwnProperty.call(STANDARD_TOOL_FOR_CATEGORY, category)
	) {
		return jsonResponse(
			{ error: `Unknown dashboard category: ${category}` },
			404,
		);
	}
	const data = await getDashboardCategory(category);
	return jsonResponse(data);
}
