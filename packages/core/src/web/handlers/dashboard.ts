import { getDashboardData } from "../../dashboard";
import { jsonResponse } from "../http-utils";

export async function handleDashboard(): Promise<Response> {
	const data = await getDashboardData();
	return jsonResponse(data);
}
