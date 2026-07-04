import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const isBun =
	typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined";
import * as memory from "@toby/core/memory/memory-service";
import { closeMemoryDbForTests } from "@toby/core/memory/memory-store";

const TMP_DIR = path.join(
	os.tmpdir(),
	`toby-memory-manual-test-${randomUUID()}`,
);

beforeEach(() => {
	fs.mkdirSync(TMP_DIR, { recursive: true });
	process.env.TOBY_DIR = TMP_DIR;
});

afterEach(() => {
	closeMemoryDbForTests();
	try {
		fs.rmSync(TMP_DIR, { recursive: true, force: true });
	} catch {
		// ignore
	}
	process.env.TOBY_DIR = undefined;
});

describe.skipIf(!isBun)("memory-manual-create", () => {
	it("creates a memory directly via createManual", () => {
		const item = memory.createManual("user1", {
			value: "Likes dark mode",
			subject: "theme",
		});
		expect(item.id).toBeTruthy();
		expect(item.value).toBe("Likes dark mode");
		expect(item.subject).toBe("theme");
		expect(item.type).toBe("fact");
		expect(item.sensitivity).toBe("normal");
		expect(item.visibility).toBe("usable_by_ai");
		expect(item.confidence).toBe(1);
	});

	it("throws when value is empty", () => {
		expect(() => memory.createManual("user1", { value: "  " })).toThrow(
			"Memory value is required",
		);
	});

	it("respects provided type, sensitivity, and visibility", () => {
		const item = memory.createManual("user1", {
			value: "Has a dog named Rex",
			type: "fact",
			sensitivity: "sensitive",
			visibility: "requires_confirmation",
			confidence: 0.8,
		});
		expect(item.type).toBe("fact");
		expect(item.sensitivity).toBe("sensitive");
		expect(item.visibility).toBe("requires_confirmation");
		expect(item.confidence).toBe(0.8);
	});

	it("created memory appears in listMemoryItems and countMemoryItems", () => {
		memory.createManual("user1", { value: "Test memory 1" });
		memory.createManual("user1", { value: "Test memory 2" });

		const items = memory.listMemoryItems("user1", { limit: 10 });
		expect(items.length).toBe(2);

		const count = memory.countMemoryItems("user1");
		expect(count).toBe(2);
	});

	it("countMemoryItems filters by query", () => {
		memory.createManual("user1", { value: "Likes coffee" });
		memory.createManual("user1", { value: "Prefers tea" });

		expect(memory.countMemoryItems("user1", { query: "coffee" })).toBe(1);
		expect(memory.countMemoryItems("user1", { query: "tea" })).toBe(1);
		expect(memory.countMemoryItems("user1", { query: "xyz" })).toBe(0);
	});

	it("listMemoryItems paginates with offset", () => {
		for (let i = 0; i < 5; i++) {
			memory.createManual("user1", { value: `Memory ${i}` });
		}
		const page1 = memory.listMemoryItems("user1", { limit: 2, offset: 0 });
		const page2 = memory.listMemoryItems("user1", { limit: 2, offset: 2 });
		expect(page1.length).toBe(2);
		expect(page2.length).toBe(2);
		expect(page1[0].id).not.toBe(page2[0].id);
	});

	it("update can change type field", () => {
		const item = memory.createManual("user1", {
			value: "Works at Acme",
			type: "fact",
		});
		const updated = memory.update("user1", item.id, { type: "project" });
		expect(updated.type).toBe("project");
		expect(updated.value).toBe("Works at Acme");
	});

	it("forget deletes a memory", () => {
		const item = memory.createManual("user1", { value: "Temporary" });
		expect(memory.get("user1", item.id)).not.toBeNull();
		memory.forget("user1", item.id);
		expect(memory.get("user1", item.id)).toBeNull();
	});

	it("listMemoryItems respects query filter", () => {
		memory.createManual("user1", { value: "Likes hiking" });
		memory.createManual("user1", { value: "Prefers swimming" });

		const results = memory.listMemoryItems("user1", { query: "hiking" });
		expect(results.length).toBe(1);
		expect(results[0].value).toBe("Likes hiking");
	});
});
