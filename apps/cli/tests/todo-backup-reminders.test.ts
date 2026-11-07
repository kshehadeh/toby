import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	applyPendingDatabaseRestore,
	createDatabaseBackupBundle,
	stageDatabaseRestore,
} from "@toby/core/config/database-backup";
import { closeMemoryDb } from "@toby/core/memory/memory-store";
import { createProject, deleteProject } from "@toby/core/projects";
import { closeChatDb } from "@toby/core/session-store";
import { todoReminderSchedule } from "@toby/core/todos/reminders";
import { todosNeedRestoreReview } from "@toby/core/todos/restore-state";
import {
	createTodo,
	getTodo,
	setReminder,
	todoReplica,
	transitionTodo,
	updateTodo,
} from "@toby/core/todos/service";
import { operations } from "@toby/core/todos/store";
import { reconcileRestoredTodos } from "@toby/core/todos/sync";
import type { Todo } from "@toby/core/todos/types";

let root: string;
let previous: string | undefined;
beforeEach(() => {
	closeChatDb();
	closeMemoryDb();
	previous = process.env.TOBY_DIR;
	root = fs.mkdtempSync(path.join(os.tmpdir(), "toby-todo-backup-"));
	process.env.TOBY_DIR = root;
});
afterEach(() => {
	closeChatDb();
	closeMemoryDb();
	if (previous === undefined) Reflect.deleteProperty(process.env, "TOBY_DIR");
	else process.env.TOBY_DIR = previous;
	fs.rmSync(root, { recursive: true, force: true });
});

describe("todo backup and reminder lifecycle", () => {
	it("restores todo definitions, recurring history, and journal without adopting another replica identity", () => {
		const todo = createTodo({
			title: "Synthetic recurring todo",
			projectId: "unresolved-project",
			projectLabel: "Other Mac",
			due: { date: "2027-03-13", time: "09:00", timezone: "America/New_York" },
			recurrence: { mode: "calendar", unit: "day" },
		}) as Todo;
		setReminder(todo.id, { id: "due", offsetMinutes: 0 });
		transitionTodo(
			todo.id,
			"complete",
			{ sequence: 0 },
			{ now: "2027-03-13T15:00:00Z" },
		);
		const snapshot = createDatabaseBackupBundle();
		const journal = operations();
		const current = getTodo(todo.id);
		// Simulate restoring an archive made by a different Mac.
		fs.writeFileSync(path.join(root, "todo-replica"), "replacement-mac");
		updateTodo(todo.id, { title: "After backup" });
		stageDatabaseRestore(snapshot);
		expect(applyPendingDatabaseRestore()).toBe(true);
		expect(todoReplica()).toBe("replacement-mac");
		expect(getTodo(todo.id)).toEqual(current);
		expect(operations()).toEqual(journal);
		expect(todosNeedRestoreReview()).toBe(true);
		expect(todoReminderSchedule()).toMatchObject({
			pausedForRestore: true,
			reminders: [],
		});
		reconcileRestoredTodos();
		expect(todoReminderSchedule().reminders).toHaveLength(1);
	});

	it("restores older databases that have no todo tables", () => {
		const old = createDatabaseBackupBundle();
		createTodo({ title: "Not in old backup" });
		stageDatabaseRestore(old);
		expect(applyPendingDatabaseRestore()).toBe(true);
		expect(operations()).toHaveLength(0);
		expect(todoReminderSchedule().pausedForRestore).toBe(true);
	});

	it("computes due-relative reminders across DST and snoozes without changing the due date", () => {
		const todo = createTodo({
			title: "DST deadline",
			due: { date: "2027-03-14", time: "09:00", timezone: "America/New_York" },
		}) as Todo;
		setReminder(todo.id, { id: "due", offsetMinutes: 30 });
		expect(todoReminderSchedule().reminders[0]?.at).toBe(
			"2027-03-14T12:30:00.000Z",
		);
		setReminder(todo.id, {
			id: "due",
			offsetMinutes: 30,
			snoozedUntil: "2027-03-14T14:00:00Z",
		});
		expect(todoReminderSchedule().reminders[0]?.at).toBe(
			"2027-03-14T14:00:00Z",
		);
		expect(getTodo(todo.id).due).toEqual(todo.due);
		transitionTodo(todo.id, "complete", { sequence: 0 });
		expect(todoReminderSchedule().reminders).toHaveLength(0);
	});

	it("unlinks a deleted local project without deleting todos or unresolved remote links", () => {
		const project = createProject({ name: "Synthetic project" });
		const linked = createTodo({
			title: "Linked",
			projectId: project.id,
			projectLabel: project.name,
		}) as Todo;
		const unresolved = createTodo({
			title: "Remote link",
			projectId: "other-mac",
			projectLabel: "Other Mac",
		}) as Todo;
		deleteProject(project.id);
		expect(getTodo(linked.id)).toMatchObject({
			projectId: null,
			projectLabel: null,
			deleted: false,
		});
		expect(getTodo(unresolved.id).projectId).toBe("other-mac");
	});
});
