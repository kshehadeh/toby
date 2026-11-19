import { clearDashboardCache } from "../dashboard/index";
import type {
	DashboardItemActionResult,
	StandardItemActionId,
} from "../dashboard/types";
import { getIntegrationModule } from "../integrations/index";
import { daemonLog } from "../logging/daemon-log";
import { createTodo, transitionTodo } from "../todos/service";
import { FEED_ACTIONS, PROVIDER_ITEM_ACTIONS } from "./actions";
import { feedbackKeyFor, localDateKey } from "./prefilter";
import {
	type FeedItemState,
	addFeedback,
	setItemState,
	snoozeUntilTomorrow,
	updateFeedState,
} from "./state";
import type { FeedActionId, FeedItem } from "./types";

export interface FeedActionRequest {
	readonly itemId: string;
	readonly actionId: string;
}

export type FeedActionOutcome =
	| {
			readonly ok: true;
			/** Short confirmation for a toast. */
			readonly message: string;
			/** Feed state recorded for the item (it is now hidden). */
			readonly state: FeedItemState;
			/** Created Toby todo, for `todo.add`. */
			readonly todoId?: string;
	  }
	| {
			readonly ok: false;
			readonly error: string;
			/** HTTP-ish status: 400 bad request, 404 unknown item, 502 provider failure. */
			readonly status: 400 | 404 | 409 | 502;
	  };

/** Dependencies for {@link performFeedAction} (test seams). */
export interface FeedActionDeps {
	readonly findItem: (itemId: string) => FeedItem | undefined;
	readonly runItemAction: (
		providerName: string,
		actionId: StandardItemActionId,
		itemId: string,
	) => Promise<DashboardItemActionResult>;
	readonly addTodo: (input: {
		title: string;
		description: string;
		due: { date: string } | null;
	}) => { id: string };
	readonly completeTodo: (todoId: string) => void;
	readonly now: () => Date;
}

async function runProviderItemAction(
	providerName: string,
	actionId: StandardItemActionId,
	itemId: string,
): Promise<DashboardItemActionResult> {
	const hook = getIntegrationModule(providerName)?.dashboard;
	if (!hook?.runItemAction) {
		return {
			ok: false,
			message: `${providerName} doesn't support this action.`,
		};
	}
	const result = await hook.runItemAction(actionId, itemId);
	// The source changed; make the next collect re-read it.
	if (result.ok) clearDashboardCache();
	return result;
}

function defaultDeps(findItem: FeedActionDeps["findItem"]): FeedActionDeps {
	return {
		findItem,
		runItemAction: runProviderItemAction,
		addTodo: (input) =>
			createTodo(
				{
					title: input.title,
					description: input.description,
					due: input.due,
				},
				{ source: "feed" },
			) as { id: string },
		completeTodo: (todoId) => {
			transitionTodo(todoId, "complete", {}, { source: "feed" });
		},
		now: () => new Date(),
	};
}

/** Todo body linking back to the Feed item's source. */
export function todoDescriptionFor(item: FeedItem): string {
	const source = item.source.providerDisplayName ?? item.source.providerName;
	const lines = [
		`Added from The Feed (${source}${item.subtitle ? ` · ${item.subtitle}` : ""}).`,
		"",
		item.reason,
	];
	if (item.source.url) lines.push("", item.source.url);
	return lines.join("\n");
}

/** Due date for a todo created from a Feed item: the event's day for calendar items. */
export function todoDueFor(item: FeedItem): { date: string } | null {
	if (item.source.category !== "calendar" || !item.timestamp) return null;
	const at = new Date(item.timestamp);
	return Number.isNaN(at.getTime()) ? null : { date: localDateKey(at) };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Run a Feed `tool` or `local` action on an item from the last ranked Feed and
 * record the resulting Feed state (the item is hidden afterwards).
 *
 * Chat and open actions run in the client and are rejected here.
 */
export async function performFeedAction(
	request: FeedActionRequest,
	deps: Partial<FeedActionDeps> & Pick<FeedActionDeps, "findItem">,
): Promise<FeedActionOutcome> {
	const d = { ...defaultDeps(deps.findItem), ...deps };
	const item = d.findItem(request.itemId);
	if (!item) {
		return {
			ok: false,
			status: 404,
			error: "That item is no longer in The Feed. Refresh and try again.",
		};
	}
	const action = item.actions.find((a) => a.id === request.actionId);
	if (!action) {
		return {
			ok: false,
			status: 400,
			error: `"${request.actionId}" isn't available for this item.`,
		};
	}
	if (action.kind === "chat" || action.kind === "open") {
		return {
			ok: false,
			status: 400,
			error: `"${action.label}" runs in the app, not the daemon.`,
		};
	}

	const now = d.now();
	const at = now.toISOString();
	const id = action.id as FeedActionId;
	const record = (entry: FeedItemState) =>
		updateFeedState((s) => setItemState(s, item.id, entry), now);

	if (id === "dismiss") {
		const state: FeedItemState = { kind: "dismissed", at };
		record(state);
		return { ok: true, message: "Dismissed.", state };
	}
	if (id === "notRelevant") {
		const state: FeedItemState = { kind: "dismissed", at };
		const key = feedbackKeyFor({
			category: item.source.category,
			providerName: item.source.providerName,
			...(item.subtitle ? { subtitle: item.subtitle } : {}),
		});
		updateFeedState((s) => {
			const hidden = setItemState(s, item.id, state);
			return addFeedback(hidden, {
				key:
					key ??
					`${item.source.category}:${item.source.providerName}:${item.title.toLowerCase()}`,
				category: item.source.category,
				title: item.title,
				...(item.subtitle ? { subtitle: item.subtitle } : {}),
				at,
			});
		}, now);
		return {
			ok: true,
			message: "Got it — you'll see fewer items like this.",
			state,
		};
	}
	if (id === "snooze") {
		const state: FeedItemState = {
			kind: "snoozed",
			at,
			until: snoozeUntilTomorrow(now).toISOString(),
		};
		record(state);
		return { ok: true, message: "Snoozed until tomorrow morning.", state };
	}

	const done: FeedItemState = { kind: "done", at, action: id };
	try {
		if (id === "todo.add") {
			const todo = d.addTodo({
				title: item.title,
				description: todoDescriptionFor(item),
				due: todoDueFor(item),
			});
			record(done);
			return {
				ok: true,
				message: "Added to your todos.",
				state: done,
				todoId: todo.id,
			};
		}
		if (id === "task.complete" && item.source.category === "todos") {
			d.completeTodo(item.source.itemId);
			record(done);
			return { ok: true, message: "Completed.", state: done };
		}
		const standard = PROVIDER_ITEM_ACTIONS[id];
		if (!standard) {
			return {
				ok: false,
				status: 400,
				error: `"${FEED_ACTIONS[id]?.label ?? id}" can't run here.`,
			};
		}
		const result = await d.runItemAction(
			item.source.providerName,
			standard,
			item.source.itemId,
		);
		if (!result.ok) {
			return {
				ok: false,
				status: 502,
				error: result.message ?? `${action.label} failed.`,
			};
		}
		record(done);
		return {
			ok: true,
			message: result.message ?? `${action.label} done.`,
			state: done,
		};
	} catch (error) {
		daemonLog("warn", "general", "feed_action_error", {
			action: id,
			provider: item.source.providerName,
			error: errorMessage(error),
		});
		const raw = (error as { status?: unknown } | null)?.status;
		const status = raw === 400 || raw === 409 ? raw : 502;
		return { ok: false, status, error: errorMessage(error) };
	}
}
