import { beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import { getDashboardFeedStatePath } from "@toby/core/config/index";
import { rebuildDashboardConfig } from "@toby/core/configure/persistence";
import { buildFeedScheduleItems } from "@toby/core/configure/tree";
import { allowedActionIds, resolveActions } from "@toby/core/feed/actions";
import {
	type FeedActionDeps,
	performFeedAction,
	todoDueFor,
} from "@toby/core/feed/execute";
import {
	isWithinActiveHours,
	resolveFeedSchedule,
} from "@toby/core/feed/schedule-config";
import {
	feedNotificationFor,
	newNowItems,
	runFeedBackgroundRefresh,
} from "@toby/core/feed/scheduler";
import {
	type FeedState,
	applyFeedState,
	clearFeedStateCache,
	isHidden,
	loadFeedState,
	pruneFeedState,
	snoozeUntilTomorrow,
} from "@toby/core/feed/state";
import type {
	FeedCandidate,
	FeedContent,
	FeedItem,
} from "@toby/core/feed/types";
import { isChatHiddenPluginTool } from "@toby/core/integrations/plugins/adapter";
import { parseDashboardItemId } from "../../plugin-email/src/tools";

const NOW = new Date("2026-11-16T15:00:00Z");

function candidate(partial: Partial<FeedCandidate> = {}): FeedCandidate {
	return {
		id: "email:email:42:INBOX",
		category: "email",
		providerName: "email",
		itemId: "42:INBOX",
		title: "Contract review",
		signals: [],
		score: 0,
		...partial,
	};
}

function item(partial: Partial<FeedItem> = {}): FeedItem {
	const c = candidate();
	return {
		id: c.id,
		source: {
			category: "email",
			providerName: "email",
			providerDisplayName: "Email",
			itemId: c.itemId,
		},
		tier: "now",
		title: c.title,
		subtitle: "alex@example.com",
		reason: "Alex needs sign-off today.",
		actions: resolveActions(
			{ ...c, providerActions: ["email.archiveItem", "email.markItemRead"] },
			["email.draftReply", "todo.add", "email.archive"],
		),
		...partial,
	};
}

function content(items: FeedItem[]): FeedContent {
	return {
		status: "ok",
		items,
		generatedAt: NOW.toISOString(),
		sources: [],
	};
}

function deps(
	feedItems: FeedItem[],
	overrides: Partial<FeedActionDeps> = {},
): Partial<FeedActionDeps> & Pick<FeedActionDeps, "findItem"> {
	return {
		findItem: (id) => feedItems.find((i) => i.id === id),
		now: () => NOW,
		runItemAction: async () => ({ ok: true }),
		addTodo: () => ({ id: "todo-1" }),
		completeTodo: () => {},
		...overrides,
	};
}

beforeEach(() => {
	clearFeedStateCache();
	fs.rmSync(getDashboardFeedStatePath(), { force: true });
});

describe("feed action support", () => {
	it("offers provider actions only when the plugin implements them", () => {
		expect(allowedActionIds(candidate())).toEqual([
			"email.draftReply",
			"todo.add",
		]);
		expect(
			allowedActionIds(candidate({ providerActions: ["email.archiveItem"] })),
		).toEqual(["email.draftReply", "todo.add", "email.archive"]);
		expect(
			allowedActionIds(candidate({ category: "tasks", providerName: "x" })),
		).toEqual(["task.help"]);
		expect(
			allowedActionIds(
				candidate({
					category: "tasks",
					providerActions: ["tasks.completeItem"],
				}),
			),
		).toEqual(["task.help", "task.complete"]);
		// Toby todos complete through the todos service.
		expect(allowedActionIds(candidate({ category: "todos" }))).toEqual([
			"task.help",
			"task.complete",
		]);
	});

	it("drops unsupported provider actions the model picked", () => {
		const ids = resolveActions(candidate(), ["email.archive"]).map((a) => a.id);
		expect(ids).toEqual([
			"email.draftReply",
			"snooze",
			"notRelevant",
			"dismiss",
		]);
	});

	it("hides item-action tools from chat tool sets", () => {
		expect(isChatHiddenPluginTool({ standardTool: "email.archiveItem" })).toBe(
			true,
		);
		expect(
			isChatHiddenPluginTool({ standardTool: "email.unreadSummary" }),
		).toBe(false);
		expect(isChatHiddenPluginTool({})).toBe(false);
	});

	it("email plugin parses dashboard item ids", () => {
		expect(parseDashboardItemId("42:INBOX")).toEqual({
			uid: 42,
			mailbox: "INBOX",
		});
		expect(parseDashboardItemId("7:Work/Clients")).toEqual({
			uid: 7,
			mailbox: "Work/Clients",
		});
		expect(parseDashboardItemId("abc:INBOX")).toBeNull();
		expect(parseDashboardItemId(42)).toBeNull();
	});
});

describe("feed state", () => {
	it("hides dismissed and done items, and snoozed items until the snooze ends", () => {
		const until = snoozeUntilTomorrow(NOW);
		const state: FeedState = {
			items: {
				a: { kind: "dismissed", at: NOW.toISOString() },
				b: { kind: "done", at: NOW.toISOString(), action: "email.archive" },
				c: {
					kind: "snoozed",
					at: NOW.toISOString(),
					until: until.toISOString(),
				},
			},
			notified: {},
			feedback: [],
			instructions: [],
		};
		expect(isHidden(state, "a", NOW)).toBe(true);
		expect(isHidden(state, "b", NOW)).toBe(true);
		expect(isHidden(state, "c", NOW)).toBe(true);
		expect(isHidden(state, "c", new Date(until.getTime() + 1))).toBe(false);
		expect(isHidden(state, "z", NOW)).toBe(false);

		const filtered = applyFeedState(
			content([item({ id: "a" }), item({ id: "keep" })]),
			state,
			NOW,
		);
		expect(filtered.items.map((i) => i.id)).toEqual(["keep"]);
	});

	it("snoozes until 8am the next local day", () => {
		const until = snoozeUntilTomorrow(NOW);
		expect(until.getHours()).toBe(8);
		expect(until.getMinutes()).toBe(0);
		expect(until.getTime()).toBeGreaterThan(NOW.getTime());
		expect(until.getTime() - NOW.getTime()).toBeLessThan(
			2 * 24 * 60 * 60 * 1000,
		);
	});

	it("prunes expired snoozes and records past the retention window", () => {
		const old = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000);
		const pruned = pruneFeedState(
			{
				items: {
					old: { kind: "dismissed", at: old.toISOString() },
					recent: { kind: "dismissed", at: NOW.toISOString() },
					expired: {
						kind: "snoozed",
						at: old.toISOString(),
						until: new Date(NOW.getTime() - 1000).toISOString(),
					},
				},
				notified: { old: old.toISOString(), recent: NOW.toISOString() },
				feedback: [],
				instructions: [],
			},
			NOW,
		);
		expect(Object.keys(pruned.items)).toEqual(["recent"]);
		expect(Object.keys(pruned.notified)).toEqual(["recent"]);
	});
});

describe("performFeedAction", () => {
	it("dismiss and snooze record Feed state and persist it", async () => {
		const feed = [item({ id: "x" }), item({ id: "y" })];
		const dismissed = await performFeedAction(
			{ itemId: "x", actionId: "dismiss" },
			deps(feed),
		);
		expect(dismissed.ok).toBe(true);
		const snoozed = await performFeedAction(
			{ itemId: "y", actionId: "snooze" },
			deps(feed),
		);
		expect(snoozed.ok && snoozed.state.kind).toBe("snoozed");

		clearFeedStateCache();
		const state = loadFeedState(NOW);
		expect(state.items.x?.kind).toBe("dismissed");
		expect(state.items.y?.until).toBe(snoozeUntilTomorrow(NOW).toISOString());
		expect(fs.existsSync(getDashboardFeedStatePath())).toBe(true);
	});

	it("add to todos creates a todo linked to the source and marks the item done", async () => {
		const created: Array<{ title: string; description: string; due: unknown }> =
			[];
		const outcome = await performFeedAction(
			{ itemId: item().id, actionId: "todo.add" },
			deps([item()], {
				addTodo: (input) => {
					created.push(input);
					return { id: "todo-9" };
				},
			}),
		);
		expect(outcome).toMatchObject({ ok: true, todoId: "todo-9" });
		expect(created[0]?.title).toBe("Contract review");
		expect(created[0]?.description).toContain("Added from The Feed (Email");
		expect(created[0]?.description).toContain("Alex needs sign-off today.");
		expect(created[0]?.due).toBeNull();
		expect(loadFeedState(NOW).items[item().id]?.action).toBe("todo.add");
	});

	it("calendar todos are due on the event's day", () => {
		const due = todoDueFor(
			item({
				source: {
					category: "calendar",
					providerName: "applecalendar",
					itemId: "e1",
				},
				timestamp: "2026-11-18T15:00:00Z",
			}),
		);
		expect(due?.date).toBe("2026-11-18");
	});

	it("runs provider actions through the standard item-action tool", async () => {
		const calls: unknown[] = [];
		const outcome = await performFeedAction(
			{ itemId: item().id, actionId: "email.archive" },
			deps([item()], {
				runItemAction: async (...args) => {
					calls.push(args);
					return { ok: true, message: "Archived." };
				},
			}),
		);
		expect(calls).toEqual([["email", "email.archiveItem", "42:INBOX"]]);
		expect(outcome).toMatchObject({ ok: true, message: "Archived." });
		expect(loadFeedState(NOW).items[item().id]?.kind).toBe("done");
	});

	it("leaves the item visible when the provider action fails", async () => {
		const outcome = await performFeedAction(
			{ itemId: item().id, actionId: "email.archive" },
			deps([item()], {
				runItemAction: async () => ({ ok: false, message: "IMAP is down" }),
			}),
		);
		expect(outcome).toEqual({ ok: false, status: 502, error: "IMAP is down" });
		expect(loadFeedState(NOW).items[item().id]).toBeUndefined();
	});

	it("hides the item while a slow provider action is still running", async () => {
		let finish: (value: { ok: boolean }) => void = () => {};
		const pending = performFeedAction(
			{ itemId: item().id, actionId: "email.archive" },
			deps([item()], {
				runItemAction: () =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			}),
		);
		// A Feed reload during the call must already see the item as done.
		expect(loadFeedState(NOW).items[item().id]?.kind).toBe("done");
		finish({ ok: true });
		expect(await pending).toMatchObject({ ok: true });
		expect(loadFeedState(NOW).items[item().id]?.kind).toBe("done");
	});

	it("restores the earlier state when a provider action throws", async () => {
		await performFeedAction(
			{ itemId: item().id, actionId: "snooze" },
			deps([item()]),
		);
		const outcome = await performFeedAction(
			{ itemId: item().id, actionId: "email.archive" },
			deps([item()], {
				runItemAction: async () => {
					throw new Error("socket closed");
				},
			}),
		);
		expect(outcome).toMatchObject({ ok: false, status: 502 });
		expect(loadFeedState(NOW).items[item().id]?.kind).toBe("snoozed");
	});

	it("completes Toby todos through the todos service", async () => {
		const todoItem = item({
			id: "todos:toby:t1",
			source: { category: "todos", providerName: "toby", itemId: "t1" },
			actions: resolveActions(
				candidate({ category: "todos", providerName: "toby", itemId: "t1" }),
				["task.complete"],
			),
		});
		const completed: string[] = [];
		const outcome = await performFeedAction(
			{ itemId: todoItem.id, actionId: "task.complete" },
			deps([todoItem], { completeTodo: (id) => completed.push(id) }),
		);
		expect(outcome.ok).toBe(true);
		expect(completed).toEqual(["t1"]);
	});

	it("rejects unknown items, actions the item doesn't offer, and client-side actions", async () => {
		expect(
			await performFeedAction(
				{ itemId: "gone", actionId: "dismiss" },
				deps([]),
			),
		).toMatchObject({ ok: false, status: 404 });
		expect(
			await performFeedAction(
				{ itemId: item().id, actionId: "task.complete" },
				deps([item()]),
			),
		).toMatchObject({ ok: false, status: 400 });
		expect(
			await performFeedAction(
				{ itemId: item().id, actionId: "email.draftReply" },
				deps([item()]),
			),
		).toMatchObject({ ok: false, status: 400 });
	});

	it("surfaces todo service conflicts with their status", async () => {
		const todoItem = item({
			id: "todos:toby:t2",
			source: { category: "todos", providerName: "toby", itemId: "t2" },
			actions: resolveActions(
				candidate({ category: "todos", providerName: "toby", itemId: "t2" }),
				["task.complete"],
			),
		});
		const outcome = await performFeedAction(
			{ itemId: todoItem.id, actionId: "task.complete" },
			deps([todoItem], {
				completeTodo: () => {
					throw Object.assign(new Error("Finish the checklist first."), {
						status: 409,
					});
				},
			}),
		);
		expect(outcome).toEqual({
			ok: false,
			status: 409,
			error: "Finish the checklist first.",
		});
	});
});

describe("feed background refresh", () => {
	const schedule = { enabled: true, intervalMinutes: 15, notifications: true };

	it("picks un-notified Now items", () => {
		const feed = content([
			item({ id: "n1" }),
			item({ id: "n2" }),
			item({ id: "t1", tier: "today" }),
		]);
		expect(
			newNowItems(feed, { n1: NOW.toISOString() }).map((i) => i.id),
		).toEqual(["n2"]);
		expect(newNowItems({ ...feed, status: "error" }, {})).toEqual([]);
	});

	it("notifies one item directly and several as a summary", () => {
		expect(feedNotificationFor([])).toBeNull();
		expect(feedNotificationFor([item({ id: "n1" })])).toEqual({
			title: "Contract review",
			body: "Alex needs sign-off today.",
			itemId: "n1",
		});
		const many = feedNotificationFor([
			item({ id: "a", title: "A" }),
			item({ id: "b", title: "B" }),
			item({ id: "c", title: "C" }),
			item({ id: "d", title: "D" }),
		]);
		expect(many?.title).toBe("4 things need your attention now");
		expect(many?.body).toBe("A, B, C, and 1 more.");
	});

	it("marks items notified only after the app accepts the notification", async () => {
		const feed = content([item({ id: "n1" })]);
		const failed = await runFeedBackgroundRefresh(schedule, {
			getFeed: async () => feed,
			notify: async () => false,
			now: () => NOW,
		});
		expect(failed.notified).toBe(0);
		expect(loadFeedState(NOW).notified.n1).toBeUndefined();

		const sent: string[] = [];
		const delivered = await runFeedBackgroundRefresh(schedule, {
			getFeed: async () => feed,
			notify: async (n) => {
				sent.push(n.title);
				return true;
			},
			now: () => NOW,
		});
		expect(delivered.notified).toBe(1);
		expect(sent).toEqual(["Contract review"]);

		// Already notified → no repeat.
		const again = await runFeedBackgroundRefresh(schedule, {
			getFeed: async () => feed,
			notify: async () => {
				throw new Error("should not notify");
			},
			now: () => NOW,
		});
		expect(again.notified).toBe(0);
	});

	it("skips notifications when they are turned off", async () => {
		const result = await runFeedBackgroundRefresh(
			{ ...schedule, notifications: false },
			{
				getFeed: async () => content([item({ id: "n1" })]),
				notify: async () => {
					throw new Error("should not notify");
				},
				now: () => NOW,
			},
		);
		expect(result.notified).toBe(0);
	});

	it("resolves schedule defaults and active hours", () => {
		expect(resolveFeedSchedule(undefined)).toEqual(schedule);
		expect(
			resolveFeedSchedule({
				backgroundRefresh: false,
				intervalMinutes: 30,
				notifications: false,
			}),
		).toEqual({ enabled: false, intervalMinutes: 30, notifications: false });
		expect(resolveFeedSchedule({ intervalMinutes: 0 }).intervalMinutes).toBe(
			15,
		);
		const at = (h: number) => {
			const d = new Date(NOW);
			d.setHours(h, 0, 0, 0);
			return d;
		};
		expect(isWithinActiveHours(at(6))).toBe(false);
		expect(isWithinActiveHours(at(7))).toBe(true);
		expect(isWithinActiveHours(at(21))).toBe(true);
		expect(isWithinActiveHours(at(22))).toBe(false);
	});
});

describe("feed schedule settings", () => {
	it("shows interval and notification rows only while background refresh is on", () => {
		const on = buildFeedScheduleItems({});
		expect(on.map((i) => i.key)).toEqual([
			"dashboard.feed.backgroundRefresh",
			"dashboard.feed.intervalMinutes",
			"dashboard.feed.notifications",
		]);
		expect(on[1]?.currentValue).toBe("15");
		expect(on[1]?.options).toEqual(["5", "15", "30", "60"]);
		const off = buildFeedScheduleItems({
			"dashboard.feed.backgroundRefresh": "false",
		});
		expect(off.map((i) => i.key)).toEqual(["dashboard.feed.backgroundRefresh"]);
	});

	it("persists only non-default schedule values", () => {
		expect(
			rebuildDashboardConfig({
				"dashboard.feed.provider": "(auto)",
				"dashboard.feed.backgroundRefresh": "true",
				"dashboard.feed.intervalMinutes": "15",
				"dashboard.feed.notifications": "true",
			}),
		).toBeUndefined();
		expect(
			rebuildDashboardConfig({
				"dashboard.feed.provider": "(auto)",
				"dashboard.feed.backgroundRefresh": "true",
				"dashboard.feed.intervalMinutes": "30",
				"dashboard.feed.notifications": "false",
			}),
		).toEqual({ feed: { intervalMinutes: 30, notifications: false } });
	});
});
