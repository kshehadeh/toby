/**
 * Dashboard standard data tools — reserved, versioned cross-plugin contracts.
 *
 * A plugin that declares a `providerCategory` (e.g. "email", "tasks") can tag
 * one of its tools with a `standardTool` ID. The dashboard aggregator calls
 * that tool directly (no LLM in the loop) and expects a fixed output shape.
 */

/**
 * Reserved standard tool IDs, one per provider category concept.
 * A plugin tags a tool definition with one of these to indicate it fulfills
 * the contract for that category's dashboard summary.
 */
export type StandardToolId = "email.unreadSummary" | "tasks.openSummary";
// future: "calendar.upcomingSummary" | "work_tracker.openSummary"

/**
 * Mapping from provider category to the standard tool ID that fulfills the
 * dashboard summary contract for that category.
 */
export const STANDARD_TOOL_FOR_CATEGORY: Record<string, StandardToolId> = {
	email: "email.unreadSummary",
	tasks: "tasks.openSummary",
};

/**
 * Reserved input shape for every standard tool.
 * The dashboard never needs to know plugin-specific query syntax.
 */
export interface DashboardSummaryInput {
	readonly limit?: number;
}

/**
 * A single item in a dashboard summary (email message, task, reminder, etc.).
 */
export interface DashboardItem {
	/** Opaque, stable identifier — round-trips back to the plugin. */
	readonly id: string;
	/** Subject / task content. */
	readonly title: string;
	/** Sender / project / list name. */
	readonly subtitle?: string;
	/** Snippet / description. */
	readonly detail?: string;
	/** ISO 8601 — received date / due date. */
	readonly timestamp?: string;
	/** Deterministic only: overdue, flagged, starred — never AI-inferred. */
	readonly urgency?: "low" | "normal" | "high";
	/** Deep link the dashboard can open. */
	readonly url?: string;
	/** Ties back to `groups[].id`. */
	readonly groupId?: string;
}

/**
 * A deterministic bucket (folder, label, flag, list) if the source data
 * already carries that signal. Never AI-inferred in v1.
 */
export interface DashboardGroup {
	readonly id: string;
	readonly label: string;
	readonly count: number;
}

/**
 * Reserved output shape for every standard tool.
 * Returned in the `result` field of `tools execute`.
 */
export interface DashboardSummaryResult {
	/** Primary badge number (e.g. "95 unread", "4 open"). */
	readonly count: number;
	/** Deterministic buckets, if the plugin has them. */
	readonly groups?: readonly DashboardGroup[];
	/** Individual items, most relevant first, capped at `limit`. */
	readonly items: readonly DashboardItem[];
	/** ISO 8601 timestamp — lets the UI show "as of 2 minutes ago". */
	readonly generatedAt: string;
}

/**
 * A single provider's dashboard summary, with provider metadata for UI rows.
 */
export interface DashboardProviderSummary {
	/** Integration module name (e.g. "email", "todoist"). */
	readonly providerName: string;
	/** Human-readable display name (e.g. "Email (IMAP/SMTP)"). */
	readonly providerDisplayName: string;
	/** Optional icon URL served by the local HTTP API. */
	readonly iconUrl?: string;
	/** The provider's summary result. */
	readonly summary: DashboardSummaryResult;
}

/**
 * Aggregated dashboard summary for a single category (e.g. all email sources).
 */
export interface DashboardCategorySummary {
	/** Sum of all source counts. */
	readonly count: number;
	/** Individual provider summaries for per-source UI rows. */
	readonly sources: readonly DashboardProviderSummary[];
	/** Concatenated, timestamp-sorted items from all sources, capped. */
	readonly items: readonly DashboardItem[];
	/** Union of groups from all sources (namespaced by provider to avoid collisions). */
	readonly groups: readonly DashboardGroup[];
	/** ISO 8601 timestamp of the most recent source generation. */
	readonly generatedAt: string;
}

/**
 * Full dashboard data response, one entry per supported category.
 * Categories with no connected providers (or no standard tool implementations)
 * are `null`.
 */
export interface DashboardData {
	readonly email: DashboardCategorySummary | null;
	readonly tasks: DashboardCategorySummary | null;
}
