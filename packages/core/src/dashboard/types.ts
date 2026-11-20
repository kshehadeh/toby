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
export type StandardToolId =
	| "email.unreadSummary"
	| "tasks.openSummary"
	| "calendar.upcomingSummary"
	| "chat.mentionsSummary"
	| "news.headlinesSummary";
// future: "work_tracker.openSummary"

/**
 * Mapping from provider category to the standard tool ID that fulfills the
 * dashboard summary contract for that category.
 */
export const STANDARD_TOOL_FOR_CATEGORY: Record<string, StandardToolId> = {
	email: "email.unreadSummary",
	tasks: "tasks.openSummary",
	calendar: "calendar.upcomingSummary",
	chat: "chat.mentionsSummary",
	news: "news.headlinesSummary",
};

/**
 * Reserved item-action standard tools. A plugin tags a tool with one of these
 * to let non-AI surfaces (The Feed) act on a dashboard item directly.
 *
 * Contract: input `{ id }` where `id` is the `DashboardItem.id` the same
 * plugin returned from its summary tool; output {@link DashboardItemActionResult}
 * (or `{ error }`). Item-action tools are hidden from chat tool sets — chat
 * agents use the plugin's richer tools instead.
 */
export type StandardItemActionId =
	| "email.archiveItem"
	| "email.markItemRead"
	| "tasks.completeItem";

export const STANDARD_ITEM_ACTION_IDS: readonly StandardItemActionId[] = [
	"email.archiveItem",
	"email.markItemRead",
	"tasks.completeItem",
];

export function isStandardItemActionId(
	id: string | undefined,
): id is StandardItemActionId {
	return (
		id !== undefined &&
		(STANDARD_ITEM_ACTION_IDS as readonly string[]).includes(id)
	);
}

export interface DashboardItemActionInput {
	readonly id: string;
}

export interface DashboardItemActionResult {
	readonly ok: boolean;
	/** Short user-facing confirmation or failure reason. */
	readonly message?: string;
}

/**
 * Reserved input shape for every standard tool.
 * The dashboard never needs to know plugin-specific query syntax.
 */
export interface DashboardSummaryInput {
	readonly limit?: number;
}

/** Calendar event facts a provider can attach to a summary item. */
export interface DashboardEventFacts {
	readonly location?: string;
	/** Event notes / agenda (trimmed). */
	readonly notes?: string;
	/** Invitees, including the user; 0 or 1 means a solo event. */
	readonly attendeeCount?: number;
	readonly allDay?: boolean;
	readonly recurring?: boolean;
}

/** Email message facts a provider can attach to a summary item. */
export interface DashboardEmailFacts {
	/** False for read messages included because they await a reply. */
	readonly unread?: boolean;
	/** Mailing list / bulk / automated mail (List-Unsubscribe, List-Id, Precedence, Auto-Submitted). */
	readonly bulk?: boolean;
	/** The user is a direct (To:) recipient rather than cc'd or bcc'd. */
	readonly direct?: boolean;
	/** The user has previously sent mail to this sender. */
	readonly knownSender?: boolean;
	/** Read, not answered, from a person — the user likely owes a reply. */
	readonly awaitingReply?: boolean;
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
	/** Absolute item URL (web or native app scheme), supplied by the provider. */
	readonly url?: string;
	/** Ties back to `groups[].id`. */
	readonly groupId?: string;
	/** Calendar only: facts that tell real meetings apart from bare holds. */
	readonly event?: DashboardEventFacts;
	/** Email only: facts that tell personal mail apart from bulk mail. */
	readonly email?: DashboardEmailFacts;
	/**
	 * Integration module name of the source provider (e.g. "todoist").
	 * Set by the aggregator on merged category items so the UI can show a
	 * per-item source icon; never set by individual plugins.
	 */
	readonly providerName?: string;
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
	/**
	 * Optional URL that opens this provider's native app / web inbox. Set by
	 * the standard tool when it depends on runtime config (e.g. the account's
	 * webmail host); takes precedence over the module's static `launchUrl`.
	 */
	readonly launchUrl?: string;
	/** ISO 8601 timestamp — lets the UI show "as of 2 minutes ago". */
	readonly generatedAt: string;
	/**
	 * Set by the aggregator/adapter (never by plugins) when the provider could
	 * not be reached; `items` is then empty rather than truly "nothing new".
	 */
	readonly error?: string;
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
	/** Optional URL/scheme that opens the provider's native app. */
	readonly launchUrl?: string;
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
	readonly calendar: DashboardCategorySummary | null;
}

/**
 * Provider open target carried on block content (not header chrome).
 * Used for multi-source "Open …" actions without a second client fetch.
 */
export interface DashboardBlockContentSource {
	readonly providerName: string;
	readonly providerDisplayName: string;
	readonly launchUrl?: string;
}

/** One actionable row in a structured dashboard section. */
export interface DashboardBlockContentItem {
	/** Display text with lightweight inline Markdown removed. */
	readonly title: string;
	/** Optional supporting copy following the title. */
	readonly subtitle?: string;
	/** First Markdown link target in the row; an absolute web or native app URL. */
	readonly url?: string;
}

/**
 * Generic structure derived from a dashboard flow's Markdown.
 *
 * `eyebrow` maps a level-two heading, `title` maps a level-one/three heading,
 * `body` holds the section prose, and `items` holds bullet rows. Clients may
 * use this richer shape while `DashboardBlockContent.text` remains the
 * backwards-compatible source and rendering fallback.
 */
export interface DashboardBlockContentSection {
	readonly id: string;
	readonly eyebrow?: string;
	readonly title?: string;
	readonly body?: string;
	readonly items: readonly DashboardBlockContentItem[];
}

/**
 * Home-dashboard **block content** — the only payload the card body needs.
 *
 * Architecture: the card *definition* owns the static header (title + actions);
 * this object is always **flow output** (markdown body + light meta for
 * empty-state / open links). One update path refreshes content only.
 */
export interface DashboardBlockContent {
	/** Block / category id (e.g. "email", "tasks", "calendar"). */
	readonly category: string;
	/**
	 * Body markdown from the block's flow. Empty string when there is nothing
	 * to show (zero items or generation produced no usable text).
	 */
	readonly text: string;
	/** ISO 8601 timestamp of content generation (or source data when empty). */
	readonly generatedAt: string;
	/** Persona used when the flow ran (or the configured dashboard persona). */
	readonly personaName: string;
	/** Item count from the flow/tool payload (for empty UX and action enablement). */
	readonly count: number;
	/** Launch URLs for Open actions. */
	readonly launchUrls: readonly string[];
	/** Optional per-provider open targets (e.g. Todoist + Reminders). */
	readonly sources?: readonly DashboardBlockContentSource[];
	/** Optional presentation structure derived from `text`. */
	readonly sections?: readonly DashboardBlockContentSection[];
}

/**
 * @deprecated Prefer {@link DashboardBlockContent}. Same shape; kept for call sites.
 */
export type DashboardCategoryAiSummary = DashboardBlockContent;
