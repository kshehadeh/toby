import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeCoreTool } from "@toby/core/core-tools";
import { closeChatDbForTests } from "@toby/core/session-store";
import {
	pauseTodosAfterRestore,
	todosNeedRestoreReview,
} from "@toby/core/todos/restore-state";
import {
	createTodo,
	deleteTodo,
	getTodo,
	listTodos,
	setChecklistItem,
	todoHistory,
	todoHistoryEntries,
	transitionTodo,
	updateTodo,
} from "@toby/core/todos/service";
import { applyOperation, operations, todoDb } from "@toby/core/todos/store";
import {
	exchangeTodoBatches,
	reconcileRestoredTodos,
	todoSyncStatus,
} from "@toby/core/todos/sync";
import {
	decryptTodoBatch,
	encryptTodoBatch,
} from "@toby/core/todos/sync-crypto";
import { createTodoBatchStore } from "@toby/core/todos/sync-files";
import type { Todo } from "@toby/core/todos/types";

let root: string;
let previous: string | undefined;
beforeEach(() => {
	closeChatDbForTests();
	previous = process.env.TOBY_DIR;
	root = fs.mkdtempSync(path.join(os.tmpdir(), "toby-todo-sync-"));
	select("a");
});
afterEach(() => {
	closeChatDbForTests();
	if (previous === undefined) Reflect.deleteProperty(process.env, "TOBY_DIR");
	else process.env.TOBY_DIR = previous;
	fs.rmSync(root, { recursive: true, force: true });
});
function select(replica: string) {
	closeChatDbForTests();
	process.env.TOBY_DIR = path.join(root, replica);
	fs.mkdirSync(process.env.TOBY_DIR, { recursive: true });
}
const password = "synthetic-todo-sync-test-password";
const store = () => createTodoBatchStore(path.join(root, "vault"));
const exchange = () => exchangeTodoBatches({ store: store(), password });
function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined)
		throw new Error("Missing test fixture");
	return value;
}

describe("encrypted todo operation sync", () => {
	it("keeps out-of-order partial definitions hidden until creation arrives", () => {
		const item = createTodo({ title: "Created" }) as Todo;
		const initial = required(operations()[0]);
		updateTodo(item.id, { priority: "high", scope: "series" });
		const edit = required(operations().at(-1));
		select("b");
		applyOperation(edit);
		expect(listTodos().todos).toEqual([]);
		expect(() => getTodo(item.id)).toThrow("downloading");
		applyOperation(initial);
		expect(getTodo(item.id)).toMatchObject({
			title: "Created",
			priority: "high",
		});
	});
	it("lets a later series edit replace an older occurrence override", () => {
		const item = createTodo({ title: "Created" }) as Todo;
		updateTodo(item.id, { title: "This occurrence" });
		expect(getTodo(item.id).title).toBe("This occurrence");
		updateTodo(item.id, { title: "Whole series", scope: "series" });
		expect(getTodo(item.id).title).toBe("Whole series");
		updateTodo(item.id, { title: "New occurrence override" });
		expect(getTodo(item.id).title).toBe("New occurrence override");
	});
	it("bootstraps a second Mac and merges offline independent edits without retransmitting the dataset", async () => {
		const item = createTodo({ title: "Initial" }) as Todo;
		expect((await exchange()).published).toBe(1);
		select("b");
		expect((await exchange()).pulled).toBe(1);
		updateTodo(item.id, { description: "B description", scope: "series" });
		select("a");
		updateTodo(item.id, { title: "A title", scope: "series" });
		expect((await exchange()).published).toBe(1);
		select("b");
		const result = await exchange();
		expect(result).toMatchObject({ pulled: 1, published: 1 });
		expect(getTodo(item.id)).toMatchObject({
			title: "A title",
			description: "B description",
		});
		select("a");
		expect((await exchange()).pulled).toBe(1);
		expect(getTodo(item.id)).toMatchObject({
			title: "A title",
			description: "B description",
		});
		expect(await exchange()).toEqual({
			pulled: 0,
			published: 0,
			uploadedBytes: 0,
			downloadedBytes: 0,
		});
		expect(todoHistory(item.id)).toHaveLength(3);
		const files = await store().list();
		expect(files).toHaveLength(3);
		expect(await store().read(required(files[0]))).not.toContain("Initial");
	});
	it("converges same-field conflicts in every delivery order and retains losing values", () => {
		const item = createTodo({ title: "Base" }) as Todo;
		const initial = operations();
		select("b");
		for (const op of initial) applyOperation(op);
		updateTodo(item.id, { title: "B edit", scope: "series" });
		const b = required(operations().at(-1));
		select("a");
		updateTodo(item.id, { title: "A edit", scope: "series" });
		const a = required(operations().at(-1));
		let expected: string | undefined;
		for (const [index, delivery] of [
			[a, b],
			[b, a],
		].entries()) {
			select(`order${index}`);
			for (const op of [...initial, ...delivery, ...delivery])
				applyOperation(op);
			expected ??= getTodo(item.id).title;
			expect(getTodo(item.id).title).toBe(expected);
			expect(todoHistory(item.id)).toHaveLength(3);
		}
	});
	it("marks the losing conflict value restorable and restores it as a new edit", () => {
		const item = createTodo({ title: "Base" }) as Todo;
		const initial = operations();
		select("b");
		for (const op of initial) applyOperation(op);
		updateTodo(item.id, { title: "B edit", scope: "series" });
		const b = required(operations().at(-1));
		select("a");
		updateTodo(item.id, { title: "A edit", scope: "series" });
		applyOperation(b);
		const winner = getTodo(item.id).title;
		const titles = todoHistoryEntries(item.id).filter(
			(entry) => entry.field === "title",
		);
		expect(
			titles.filter((entry) => entry.current).map((entry) => entry.value),
		).toEqual([winner]);
		const loser = required(
			titles.find((entry) => entry.value !== winner && entry.value !== "Base"),
		);
		expect(loser.restorable).toBe(true);
		const before = operations().length;
		executeCoreTool("todos.restoreField", {
			id: item.id,
			operationId: loser.operationId,
			field: "title",
		});
		expect(getTodo(item.id).title).toBe(loser.value as string);
		expect(operations()).toHaveLength(before + 1);
		expect(() =>
			executeCoreTool("todos.restoreField", {
				id: item.id,
				operationId: loser.operationId,
				field: "updatedAt",
			}),
		).toThrow();
	});
	it("reports pending local changes until they are published", async () => {
		createTodo({ title: "Pending" });
		expect(todoSyncStatus().pending).toBe(1);
		await exchange();
		expect(todoSyncStatus()).toMatchObject({ pending: 0, error: null });
	});
	it("merges independent checklist items and deletion wins against ordinary edits", () => {
		const item = createTodo({
			title: "Base",
			checklist: ["One", "Two"],
		}) as Todo;
		const initial = operations();
		select("b");
		for (const op of initial) applyOperation(op);
		setChecklistItem(item.id, {
			...required(item.checklist[1]),
			checked: true,
		});
		const b = required(operations().at(-1));
		select("a");
		setChecklistItem(item.id, {
			...required(item.checklist[0]),
			checked: true,
		});
		applyOperation(b);
		expect(getTodo(item.id).checklist.every((check) => check.checked)).toBe(
			true,
		);
		deleteTodo(item.id);
		const deletion = required(operations().at(-1));
		select("b");
		updateTodo(item.id, { title: "Concurrent edit", scope: "series" });
		applyOperation(deletion);
		expect(getTodo(item.id).deleted).toBe(true);
	});
	it("concurrent complete and skip converge to one deterministic successor", () => {
		const item = createTodo({
			title: "Repeat",
			due: { date: "2027-01-01" },
			recurrence: { mode: "calendar", unit: "day" },
		}) as Todo;
		const initial = operations();
		select("b");
		for (const op of initial) applyOperation(op);
		transitionTodo(
			item.id,
			"skip",
			{ sequence: 0 },
			{ now: "2027-01-02T12:00:00Z" },
		);
		const b = required(operations().at(-1));
		select("a");
		transitionTodo(
			item.id,
			"complete",
			{ sequence: 0 },
			{ now: "2027-01-01T12:00:00Z" },
		);
		const a = required(operations().at(-1));
		applyOperation(b);
		const winner = getTodo(item.id);
		select("b");
		applyOperation(a);
		expect(getTodo(item.id)).toEqual(winner);
		expect(winner.sequence).toBe(1);
	});
	it("authenticates and validates complete batches before application", async () => {
		createTodo({ title: "Secret title" });
		const ops = operations();
		const encrypted = await encryptTodoBatch(ops, password);
		expect(await decryptTodoBatch(JSON.stringify(encrypted), password)).toEqual(
			ops,
		);
		await expect(
			decryptTodoBatch(JSON.stringify(encrypted), "wrong"),
		).rejects.toThrow("decrypt");
		await expect(
			decryptTodoBatch(
				JSON.stringify({ ...encrypted, version: 999 }),
				password,
			),
		).rejects.toThrow();
		await expect(
			decryptTodoBatch(
				JSON.stringify({
					...encrypted,
					encryption: { ...encrypted.encryption, n: 1073741824 },
				}),
				password,
			),
		).rejects.toThrow();
		select("b");
		await store().write(
			"a/bad.json",
			JSON.stringify({
				...encrypted,
				ciphertext: `${encrypted.ciphertext.slice(0, -8)}AAAAAAAA`,
			}),
		);
		await expect(exchange()).rejects.toThrow();
		expect(operations()).toHaveLength(0);
	});
	it("rejects invalid or reused operation IDs without partial writes", () => {
		const item = createTodo({ title: "Valid" }) as Todo;
		const original = required(operations()[0]);
		expect(() => applyOperation({ ...original, source: "different" })).toThrow(
			"reused",
		);
		expect(() =>
			applyOperation({
				...original,
				id: "malformed",
				changes: [
					{ kind: "todo", id: item.id, fields: { title: "Must not persist" } },
					{ kind: "todo", id: item.id, fields: { priority: "invalid" } },
				],
			}),
		).toThrow();
		expect(getTodo(item.id).title).toBe("Valid");
		expect(operations()).toHaveLength(1);
	});
	it("refuses traversal and never overwrites immutable batches", async () => {
		await expect(store().write("../outside.json", "{}")).rejects.toThrow(
			"filename",
		);
		await store().write("replica/batch.json", "{}");
		await expect(
			store().write("replica/batch.json", "different"),
		).rejects.toThrow();
		expect(await store().read("replica/batch.json")).toBe("{}");
	});
	it("pauses after restore until explicit reconciliation and preserves the restored journal", async () => {
		createTodo({ title: "Restored" });
		pauseTodosAfterRestore();
		expect(todosNeedRestoreReview()).toBe(true);
		await expect(exchange()).rejects.toThrow("reviewing");
		expect(operations()).toHaveLength(1);
		reconcileRestoredTodos();
		expect(todosNeedRestoreReview()).toBe(false);
		expect((await exchange()).published).toBe(1);
		expect(
			todoDb().query("SELECT count(*) AS count FROM todo_operations").get(),
		).toEqual({ count: 1 });
	});
});
