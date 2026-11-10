import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	coreFlowCatalog,
	createCoreChatTools,
	executeCoreTool,
} from "@toby/core/core-tools";
import { executeToolRef } from "@toby/core/flows/tool-resolve";
import { closeChatDbForTests } from "@toby/core/session-store";
import { dueInstant, isOverdue, nextDue } from "@toby/core/todos/recurrence";
import {
	createTodo,
	deleteTodo,
	getTodo,
	listOrganization,
	listTodos,
	saveOrganization,
	setChecklistItem,
	setReminder,
	setTodoTag,
	todoHistory,
	transitionTodo,
	updateTodo,
} from "@toby/core/todos/service";
import {
	type Due,
	type Recurrence,
	type Todo,
	dateSchema,
} from "@toby/core/todos/types";

let dir: string;
let previous: string | undefined;
beforeEach(() => {
	closeChatDbForTests();
	previous = process.env.TOBY_DIR;
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-todos-test-"));
	process.env.TOBY_DIR = dir;
});
afterEach(() => {
	closeChatDbForTests();
	if (previous === undefined) Reflect.deleteProperty(process.env, "TOBY_DIR");
	else process.env.TOBY_DIR = previous;
	fs.rmSync(dir, { recursive: true, force: true });
});

const due = (
	date: string,
	time: string | null = null,
	timezone = "UTC",
): Due => ({ date, time, timezone });
const calendar = (unit: Recurrence["unit"], interval = 1): Recurrence => ({
	mode: "calendar",
	unit,
	interval,
});
const create = (input: Record<string, unknown> = {}) =>
	createTodo({ title: "A todo", ...input }) as Todo;
function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined)
		throw new Error("Missing test fixture");
	return value;
}

describe("Toby todo domain", () => {
	it("seeds Inbox and supports fields, filters, pagination, and clearing", () => {
		expect(listOrganization("list")).toEqual([{ id: "inbox", name: "Inbox" }]);
		const a = create({
			description: "needle",
			priority: "high",
			projectId: "project",
			due: due("2027-01-02"),
		});
		create({ title: "Other" });
		expect(
			listTodos({
				query: "needle",
				priority: "high",
				projectId: "project",
			}).todos.map((t) => t.id),
		).toEqual([a.id]);
		expect(listTodos({ limit: 1, offset: 1 }).todos).toHaveLength(1);
		updateTodo(a.id, { due: null, projectId: null });
		expect(getTodo(a.id)).toMatchObject({
			due: null,
			projectId: null,
			description: "needle",
		});
	});
	it("previews without persistence and enforces revisions", () => {
		expect(createTodo({ title: "Preview" }, { dryRun: true })).toMatchObject({
			dryRun: true,
		});
		expect(listTodos().total).toBe(0);
		const item = create();
		updateTodo(
			item.id,
			{ title: "Changed" },
			{ expectedRevision: item.revision },
		);
		expect(() =>
			updateTodo(
				item.id,
				{ title: "Stale" },
				{ expectedRevision: item.revision },
			),
		).toThrow("changed");
	});
	it("replays mutation results and rejects idempotency key reuse", () => {
		const first = createTodo(
			{ title: "Once" },
			{ idempotencyKey: "create-once" },
		);
		expect(
			createTodo({ title: "Once" }, { idempotencyKey: "create-once" }),
		).toEqual(first);
		expect(listTodos().total).toBe(1);
		expect(() =>
			createTodo({ title: "Different" }, { idempotencyKey: "create-once" }),
		).toThrow("different inputs");
	});
	it("removes lists and tags without deleting their todos", () => {
		const list = saveOrganization("list", { name: "Work" }) as { id: string };
		const tag = saveOrganization("tag", { name: "Urgent" }) as { id: string };
		const item = create({ listId: list.id, tags: [tag.id] });
		saveOrganization("list", { id: list.id, remove: true });
		saveOrganization("tag", { id: tag.id, remove: true });
		expect(getTodo(item.id)).toMatchObject({
			listId: "inbox",
			tags: [],
			deleted: false,
		});
		expect(() =>
			saveOrganization("list", { id: "inbox", remove: true }),
		).toThrow("Inbox");
		expect(() => setTodoTag(item.id, tag.id, true)).toThrow("deleted");
	});
	it("requires checklist acknowledgement and preserves history on delete/restore", () => {
		const item = create({ checklist: ["First", "Second"] });
		expect(() => transitionTodo(item.id, "complete")).toThrow("unfinished");
		const first = required(item.checklist[0]);
		setChecklistItem(item.id, { ...first, checked: true });
		expect(getTodo(item.id).checklist.filter((i) => i.checked)).toHaveLength(1);
		transitionTodo(item.id, "complete", { allowIncompleteChecklist: true });
		deleteTodo(item.id);
		expect(listTodos({ status: "deleted" }).total).toBe(1);
		expect(() => updateTodo(item.id, { title: "Cannot edit" })).toThrow(
			"Restore",
		);
		deleteTodo(item.id, true);
		expect(listTodos({ status: "completed" }).total).toBe(1);
		expect(todoHistory(item.id)).toHaveLength(5);
	});
	it("does not invent midnight reminders for date-only deadlines", () => {
		const item = create({ due: due("2027-01-02") });
		expect(() =>
			setReminder(item.id, { id: "reminder", offsetMinutes: 0 }),
		).toThrow("explicit reminder time");
		setReminder(item.id, { id: "reminder", at: "2027-01-02T09:00:00Z" });
		expect(getTodo(item.id).reminders).toHaveLength(1);
	});
	it("attaches a due-time reminder when create asks to be reminded", () => {
		const item = create({
			due: due("2027-01-02", "09:00"),
			remind: true,
		});
		expect(getTodo(item.id).reminders).toEqual([
			{ id: "due", at: null, offsetMinutes: 0, snoozedUntil: null },
		]);
		// The reminder is part of the create operation, so a retry cannot duplicate it.
		expect(todoHistory(item.id)).toHaveLength(1);
	});
	it("refuses remind on date-only or undated todos instead of inventing a time", () => {
		expect(() => create({ due: due("2027-01-02"), remind: true })).toThrow(
			"due date with a time",
		);
		expect(() => create({ remind: true })).toThrow("due date with a time");
		expect(listTodos().total).toBe(0);
	});
	it("attaches the reminder through the chat/flow tool adapter too", () => {
		const created = executeCoreTool("todos.create", {
			title: "Tool path",
			due: due("2027-01-03", "08:30"),
			remind: true,
		}) as Todo;
		expect(getTodo(created.id).reminders[0]).toMatchObject({
			id: "due",
			offsetMinutes: 0,
		});
	});
	it("keeps completed checklist and deadline snapshots and carries relative reminders forward", () => {
		const item = create({
			due: due("2027-01-01", "09:00"),
			recurrence: calendar("day"),
			checklist: ["Original"],
		});
		setChecklistItem(item.id, {
			...required(item.checklist[0]),
			checked: true,
		});
		setReminder(item.id, {
			id: "due",
			offsetMinutes: 15,
			snoozedUntil: "2027-01-01T10:00:00Z",
		});
		transitionTodo(
			item.id,
			"complete",
			{ sequence: 0 },
			{ now: "2027-01-01T12:00:00Z" },
		);
		expect(getTodo(item.id).reminders[0]).toMatchObject({
			offsetMinutes: 15,
			snoozedUntil: null,
		});
		updateTodo(item.id, {
			due: due("2027-02-01"),
			recurrence: null,
			scope: "series",
		});
		setChecklistItem(item.id, {
			...required(item.checklist[0]),
			text: "Changed",
			checked: false,
		});
		expect(getTodo(item.id, 0)).toMatchObject({
			due: due("2027-01-01", "09:00"),
			checklist: [{ ...required(item.checklist[0]), checked: true }],
		});
	});
	it("advances just once across missed repeats and retries", () => {
		const item = create({
			due: due("2027-01-01"),
			recurrence: calendar("day"),
		});
		const params = { sequence: 0 };
		const context = {
			now: "2027-01-10T12:00:00Z",
			idempotencyKey: "completion",
		};
		const result = transitionTodo(item.id, "complete", params, context);
		expect(getTodo(item.id)).toMatchObject({
			sequence: 1,
			due: due("2027-01-11"),
			state: { status: "open" },
		});
		expect(transitionTodo(item.id, "complete", params, context)).toEqual(
			result,
		);
		expect(() => transitionTodo(item.id, "complete", params)).toThrow(
			"already closed",
		);
		expect(listTodos({ status: "completed" }).total).toBe(1);
	});
	it("keeps occurrence edits separate from future series and completed snapshots", () => {
		const item = create({
			title: "Series",
			due: due("2027-01-01"),
			recurrence: calendar("day"),
		});
		updateTodo(item.id, { title: "Just this one", scope: "occurrence" });
		expect(getTodo(item.id).title).toBe("Just this one");
		transitionTodo(
			item.id,
			"complete",
			{ sequence: 0 },
			{ now: "2027-01-01T12:00:00Z" },
		);
		expect(getTodo(item.id).title).toBe("Series");
		updateTodo(item.id, { title: "New series", scope: "series" });
		expect(getTodo(item.id).title).toBe("New series");
		expect(getTodo(item.id, 0).title).toBe("Just this one");
	});
	it("reopens an untouched successor, but refuses to overwrite later work", () => {
		const item = create({
			due: due("2027-01-01"),
			recurrence: calendar("day"),
		});
		transitionTodo(
			item.id,
			"complete",
			{ sequence: 0 },
			{ now: "2027-01-01T12:00:00Z" },
		);
		transitionTodo(item.id, "reopen", { sequence: 0 });
		expect(getTodo(item.id).sequence).toBe(0);
		transitionTodo(
			item.id,
			"skip",
			{ sequence: 0 },
			{ now: "2027-01-01T12:00:00Z" },
		);
		updateTodo(item.id, { due: due("2027-01-03") });
		expect(() => transitionTodo(item.id, "reopen", { sequence: 0 })).toThrow(
			"Later occurrences",
		);
	});
});

describe("calendar recurrence", () => {
	it("validates calendar dates without throwing on invalid Date objects", () => {
		for (const value of ["2027-02-29", "2027-99-99", "not-a-date"])
			expect(dateSchema.safeParse(value).success).toBe(false);
		expect(dateSchema.safeParse("2028-02-29").success).toBe(true);
	});
	it("preserves month-end and leap-year anchors", () => {
		const anchor = due("2027-01-31");
		const feb = required(
			nextDue(anchor, anchor, calendar("month"), "2027-01-31T12:00:00Z"),
		);
		expect(feb.date).toBe("2027-02-28");
		expect(
			nextDue(anchor, feb, calendar("month"), "2027-02-28T12:00:00Z")?.date,
		).toBe("2027-03-31");
		const leap = due("2028-02-29");
		expect(
			nextDue(leap, leap, calendar("year"), "2028-02-29T12:00:00Z")?.date,
		).toBe("2029-02-28");
	});
	it("does not recreate the current slot when completed early", () => {
		const anchor = due("2027-01-05", "09:00");
		expect(
			nextDue(anchor, anchor, calendar("day"), "2027-01-01T12:00:00Z")?.date,
		).toBe("2027-01-06");
	});
	it("uses local calendar days and selected weekdays with an end date", () => {
		const anchor = due("2027-01-04", "09:00", "America/New_York");
		const rule = {
			...calendar("week"),
			weekdays: [1, 3, 5],
			endDate: "2027-01-06",
		};
		expect(nextDue(anchor, anchor, rule, "2027-01-04T15:00:00Z")?.date).toBe(
			"2027-01-06",
		);
		expect(
			nextDue(
				anchor,
				due("2027-01-06", "09:00", anchor.timezone),
				rule,
				"2027-01-06T15:00:00Z",
			),
		).toBeNull();
	});
	it("resolves DST gaps forward and overlaps to the earlier instant", () => {
		expect(
			dueInstant(due("2027-03-14", "02:30", "America/New_York"))?.toISOString(),
		).toBe("2027-03-14T07:30:00.000Z");
		expect(
			dueInstant(due("2027-11-07", "01:30", "America/New_York"))?.toISOString(),
		).toBe("2027-11-07T05:30:00.000Z");
	});
	it("keeps date-only items current until their day ends", () => {
		const item = due("2027-01-01", null, "America/Los_Angeles");
		expect(isOverdue(item, new Date("2027-01-02T07:59:00Z"))).toBe(false);
		expect(isOverdue(item, new Date("2027-01-02T08:00:00Z"))).toBe(true);
	});
	it("advances completion-based repeats from completion rather than deadline", () => {
		const anchor = due("2027-01-01", "09:00");
		expect(
			nextDue(
				anchor,
				anchor,
				{ mode: "completion", unit: "day", interval: 3 },
				"2027-01-10T15:45:00Z",
			),
		).toEqual(due("2027-01-13", "15:45"));
	});
});

describe("shared tool adapters", () => {
	it("catalogs built-in tools without integrations", async () => {
		expect(
			(await coreFlowCatalog()).some((t) => t.coreTool === "todos.create"),
		).toBe(true);
		expect(
			createCoreChatTools({ dryRun: false, appliedActions: [] }).createTobyTodo,
		).toBeDefined();
	});
	it("creates, updates, and completes through Flow execution with stable retry keys", async () => {
		const input = { title: "From Flow" };
		const created = await executeToolRef({ coreTool: "todos.create" }, input, {
			idempotencyKey: "flow:run:create",
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		const item = created.result as Todo;
		expect(
			await executeToolRef({ coreTool: "todos.create" }, input, {
				idempotencyKey: "flow:run:create",
			}),
		).toEqual(created);
		expect(
			(
				await executeToolRef(
					{ coreTool: "todos.update" },
					{ id: item.id, changes: { title: "Updated" } },
				)
			).ok,
		).toBe(true);
		expect(
			(
				await executeToolRef(
					{ coreTool: "todos.complete" },
					{ id: item.id, sequence: 0 },
				)
			).ok,
		).toBe(true);
		expect(getTodo(item.id)).toMatchObject({
			title: "Updated",
			state: { status: "completed" },
		});
		expect(todoHistory(item.id)).toHaveLength(3);
	});
	it("uses the same validation and dry-run semantics in the core tool envelope", () => {
		expect(
			executeCoreTool("todos.create", { title: "Preview", dryRun: true }),
		).toMatchObject({ dryRun: true });
		expect(listTodos().total).toBe(0);
		expect(() => executeCoreTool("todos.create", { title: "" })).toThrow();
	});
	it("creates a notification file when todos are created or modified", () => {
		const notifyPath = path.join(dir, ".todos-changed");
		expect(fs.existsSync(notifyPath)).toBe(false);

		// Create a todo
		const item = createTodo({ title: "Test notification" });
		expect(fs.existsSync(notifyPath)).toBe(true);

		// Read the initial timestamp
		const stat1 = fs.statSync(notifyPath);
		const mtime1 = stat1.mtimeMs;

		// Wait a bit to ensure timestamp would change
		const start = Date.now();
		while (Date.now() - start < 10) {
			// Busy wait for 10ms
		}

		// Update the todo
		updateTodo(item.id, { title: "Updated" });
		const stat2 = fs.statSync(notifyPath);
		const mtime2 = stat2.mtimeMs;

		// Timestamp should have changed
		expect(mtime2).toBeGreaterThan(mtime1);
	});
});
