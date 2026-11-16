import { getDashboardCategory } from "../dashboard/index";
import type {
	DashboardBlockContentSource,
	DashboardCategorySummary,
} from "../dashboard/types";
import { daemonLog } from "../logging/daemon-log";
import { listTodos } from "../todos/service";
import type { Todo } from "../todos/types";
import { type RawFeedCandidate, localDateKey } from "./prefilter";
import type { FeedCategory } from "./types";

/** Aggregator categories the Feed reads (standard dashboard tools). */
const AGGREGATOR_CATEGORIES = ["email", "calendar", "tasks"] as const;
const PER_CATEGORY_LIMIT = 30;
const TODO_LIMIT = 200;

export const TOBY_TODOS_PROVIDER = "toby";

export interface FeedCollection {
	readonly candidates: readonly RawFeedCandidate[];
	readonly sources: readonly DashboardBlockContentSource[];
}

export function feedCandidateId(
	category: FeedCategory,
	providerName: string,
	itemId: string,
): string {
	return `${category}:${providerName}:${itemId}`;
}

/** Map one aggregator category summary into raw Feed candidates. */
export function candidatesFromCategory(
	category: FeedCategory,
	data: DashboardCategorySummary,
): RawFeedCandidate[] {
	const displayNames = new Map(
		data.sources.map((s) => [s.providerName, s.providerDisplayName]),
	);
	return data.items.map((item) => {
		const providerName = item.providerName ?? "unknown";
		const providerDisplayName = displayNames.get(providerName);
		return {
			id: feedCandidateId(category, providerName, item.id),
			category,
			providerName,
			...(providerDisplayName ? { providerDisplayName } : {}),
			itemId: item.id,
			title: item.title || "(untitled)",
			...(item.subtitle ? { subtitle: item.subtitle } : {}),
			...(item.detail ? { detail: item.detail } : {}),
			...(item.timestamp ? { timestamp: item.timestamp } : {}),
			...(item.urgency ? { urgency: item.urgency } : {}),
			...(item.url ? { url: item.url } : {}),
		};
	});
}

/** Open Toby todos that are due by tomorrow or high priority. */
export function candidatesFromTodos(
	todos: readonly Todo[],
	tomorrowKey: string,
): RawFeedCandidate[] {
	return todos
		.filter(
			(t) =>
				!t.deleted &&
				t.state.status === "open" &&
				((t.due && t.due.date <= tomorrowKey) || t.priority === "high"),
		)
		.map((t) => ({
			id: feedCandidateId("todos", TOBY_TODOS_PROVIDER, t.id),
			category: "todos" as const,
			providerName: TOBY_TODOS_PROVIDER,
			providerDisplayName: "Toby Todos",
			itemId: t.id,
			title: t.title,
			...(t.description.trim()
				? { detail: t.description.trim().slice(0, 280) }
				: {}),
			...(t.due ? { dueDate: t.due.date } : {}),
			...(t.priority === "high" ? { urgency: "high" as const } : {}),
		}));
}

function tomorrowKey(now: Date): string {
	const d = new Date(now);
	d.setDate(d.getDate() + 1);
	return localDateKey(d);
}

/**
 * Gather raw candidates from every connected source. A failing source is
 * logged and skipped — it never blanks the Feed.
 */
export async function collectFeedCandidates(params?: {
	readonly force?: boolean;
	readonly now?: Date;
}): Promise<FeedCollection> {
	const force = params?.force === true;
	const now = params?.now ?? new Date();
	const candidates: RawFeedCandidate[] = [];
	const sources: DashboardBlockContentSource[] = [];

	const results = await Promise.all(
		AGGREGATOR_CATEGORIES.map(async (category) => {
			try {
				return {
					category,
					data: await getDashboardCategory(category, {
						limit: PER_CATEGORY_LIMIT,
						force,
					}),
				};
			} catch (error) {
				daemonLog("warn", "general", "feed_collect_error", {
					category,
					error: error instanceof Error ? error.message : String(error),
				});
				return { category, data: null };
			}
		}),
	);

	for (const { category, data } of results) {
		if (!data) continue;
		candidates.push(...candidatesFromCategory(category, data));
		for (const s of data.sources) {
			sources.push({
				providerName: s.providerName,
				providerDisplayName: s.providerDisplayName,
				...(s.launchUrl ? { launchUrl: s.launchUrl } : {}),
			});
		}
	}

	try {
		const { todos } = listTodos({ status: "open", limit: TODO_LIMIT });
		const todoCandidates = candidatesFromTodos(todos, tomorrowKey(now));
		candidates.push(...todoCandidates);
		sources.push({
			providerName: TOBY_TODOS_PROVIDER,
			providerDisplayName: "Toby Todos",
		});
	} catch (error) {
		daemonLog("warn", "general", "feed_collect_error", {
			category: "todos",
			error: error instanceof Error ? error.message : String(error),
		});
	}

	return { candidates, sources };
}
