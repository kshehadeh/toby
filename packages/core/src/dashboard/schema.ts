import { z } from "zod";
import { daemonLog } from "../logging/daemon-log";
import type { DashboardSummaryResult } from "./types";

const dashboardGroupSchema = z.object({
	id: z.string(),
	label: z.string(),
	count: z.number(),
});

const dashboardItemSchema = z.object({
	id: z.string(),
	title: z.string(),
	subtitle: z.string().optional(),
	detail: z.string().optional(),
	timestamp: z.string().optional(),
	urgency: z.enum(["low", "normal", "high"]).optional(),
	url: z.string().optional(),
	groupId: z.string().optional(),
});

const dashboardSummaryResultSchema = z.object({
	count: z.number(),
	groups: z.array(dashboardGroupSchema).optional(),
	items: z.array(dashboardItemSchema),
	launchUrl: z.string().optional(),
	generatedAt: z.string(),
});

/**
 * Validate a plugin's standard tool result against the dashboard contract.
 * Returns the parsed result on success, or `null` on failure (with a daemon
 * log warning so malformed plugins degrade gracefully rather than breaking
 * the dashboard).
 */
export function validateDashboardSummary(
	raw: unknown,
	pluginName: string,
): DashboardSummaryResult | null {
	const parsed = dashboardSummaryResultSchema.safeParse(raw);
	if (!parsed.success) {
		daemonLog("warn", "plugin", "dashboard_summary_invalid", {
			plugin: pluginName,
			error: parsed.error.issues[0]?.message ?? "validation failed",
		});
		return null;
	}
	return parsed.data as DashboardSummaryResult;
}
