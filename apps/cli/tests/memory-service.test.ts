import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const isBun =
	typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined";
import * as memory from "../src/memory/memory-service";
import { closeMemoryDbForTests } from "../src/memory/memory-store";

const TMP_DIR = path.join(
	os.tmpdir(),
	`toby-memory-service-test-${randomUUID()}`,
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

describe.skipIf(!isBun)("memory-service", () => {
	it("saves a normal preference via auto-save", () => {
		const proposal = memory.propose(
			"user1",
			{
				userId: "user1",
				type: "preference",
				subject: "theme",
				value: "I prefer dark mode",
				confidence: 0.9,
				sensitivity: "normal",
				visibility: "usable_by_ai",
				expiresAt: null,
			},
			{ system: "chat", excerpt: "User said they prefer dark mode" },
			"User explicitly stated preference",
		);
		expect(proposal.status).toBe("accepted");

		const results = memory.search("user1", "dark mode");
		expect(results).toHaveLength(1);
		expect(results[0]?.value).toBe("I prefer dark mode");
	});

	it("proposes a sensitive memory and keeps it pending", () => {
		const proposal = memory.propose(
			"user1",
			{
				userId: "user1",
				type: "life_event",
				subject: "health",
				value: "Taking medication for anxiety",
				confidence: 0.7,
				sensitivity: "normal",
				visibility: "usable_by_ai",
				expiresAt: null,
			},
			{ system: "gmail", sourceId: "msg-abc" },
			"Inferred from email content",
		);
		expect(proposal.status).toBe("pending");
		expect(proposal.sensitivity).toBe("restricted");
		expect(proposal.suggestedVisibility).toBe("requires_confirmation");
	});

	it("rejects direct writes — propose always goes through proposal flow", () => {
		const proposal = memory.propose(
			"user1",
			{
				userId: "user1",
				type: "relationship",
				subject: "colleague",
				value: "Jane is a coworker",
				confidence: 0.6,
				sensitivity: "normal",
				visibility: "usable_by_ai",
				expiresAt: null,
			},
			{ system: "chat" },
			"AI inferred relationship",
		);
		expect(proposal.status).toBe("pending");
		const searchResults = memory.search("user1", "Jane");
		expect(searchResults).toHaveLength(0);
	});

	it("retrieves relevant memories for a task", () => {
		memory.propose(
			"user1",
			{
				userId: "user1",
				type: "preference",
				subject: "email",
				value: "I prefer daily digest emails",
				confidence: 0.95,
				sensitivity: "normal",
				visibility: "usable_by_ai",
				expiresAt: null,
			},
			{ system: "chat" },
			"User stated preference",
		);
		memory.propose(
			"user1",
			{
				userId: "user1",
				type: "preference",
				subject: "meeting",
				value: "I prefer morning meetings",
				confidence: 0.9,
				sensitivity: "normal",
				visibility: "usable_by_ai",
				expiresAt: null,
			},
			{ system: "chat" },
			"User stated preference",
		);

		const bundle = memory.retrieveForTask(
			"user1",
			"Draft a reply to this email",
		);
		expect(bundle.memories.length).toBeGreaterThanOrEqual(1);
		expect(bundle.summary).toContain("relevant");
	});

	it("excludes private/requires-confirmation memories from normal retrieval", () => {
		const proposal = memory.propose(
			"user1",
			{
				userId: "user1",
				type: "life_event",
				subject: "health",
				value: "Taking medication for anxiety",
				confidence: 0.8,
				sensitivity: "normal",
				visibility: "usable_by_ai",
				expiresAt: null,
			},
			{ system: "gmail" },
			"From health email",
		);
		expect(proposal.status).toBe("pending");

		const bundle = memory.retrieveForTask("user1", "health information");
		const hasHealth = bundle.memories.some((m) =>
			m.value.includes("medication"),
		);
		expect(hasHealth).toBe(false);
	});

	it("explains why a memory exists", () => {
		const proposal = memory.propose(
			"user1",
			{
				userId: "user1",
				type: "preference",
				subject: "reports",
				value: "I prefer weekly reports",
				confidence: 0.95,
				sensitivity: "normal",
				visibility: "usable_by_ai",
				expiresAt: null,
			},
			{ system: "chat", excerpt: "User said weekly" },
			"Explicitly stated",
		);
		expect(proposal.status).toBe("accepted");

		const searchResults = memory.search("user1", "reports");
		expect(searchResults.length).toBeGreaterThanOrEqual(1);
		const itemId = searchResults[0]?.id;

		const explanation = memory.explain("user1", itemId);
		expect(explanation.item.value).toBe("I prefer weekly reports");
		expect(explanation.sources.length).toBeGreaterThanOrEqual(1);
		expect(explanation.auditTrail.length).toBeGreaterThanOrEqual(1);
	});

	it("forgets a memory", () => {
		const proposal = memory.propose(
			"user1",
			{
				userId: "user1",
				type: "fact",
				subject: "timezone",
				value: "User is in PST timezone",
				confidence: 0.95,
				sensitivity: "normal",
				visibility: "usable_by_ai",
				expiresAt: null,
			},
			{ system: "chat" },
			"Stated by user",
		);
		expect(proposal.status).toBe("accepted");

		const searchResults = memory.search("user1", "timezone");
		expect(searchResults).toHaveLength(1);

		memory.forget("user1", searchResults[0]?.id);
		expect(memory.search("user1", "timezone")).toHaveLength(0);
	});

	it("uses memory.sqlite, not chat.sqlite", () => {
		memory.propose(
			"user1",
			{
				userId: "user1",
				type: "fact",
				value: "Isolation test",
				confidence: 0.9,
				sensitivity: "normal",
				visibility: "usable_by_ai",
				expiresAt: null,
			},
			{ system: "manual" },
			"test",
		);
		const memoryDbPath = path.join(TMP_DIR, "memory.sqlite");
		const chatDbPath = path.join(TMP_DIR, "chat.sqlite");
		expect(fs.existsSync(memoryDbPath)).toBe(true);
		expect(fs.existsSync(chatDbPath)).toBe(false);
	});

	it("allows manual save of a pending proposal", () => {
		const proposal = memory.propose(
			"user1",
			{
				userId: "user1",
				type: "relationship",
				subject: "manager",
				value: "Bob is my manager",
				confidence: 0.7,
				sensitivity: "normal",
				visibility: "usable_by_ai",
				expiresAt: null,
			},
			{ system: "chat" },
			"User mentioned manager",
		);
		expect(proposal.status).toBe("pending");

		const item = memory.save("user1", proposal.id);
		expect(item.value).toBe("Bob is my manager");
		expect(item.visibility).toBe("requires_confirmation");

		const searchResults = memory.search("user1", "Bob");
		expect(searchResults).toHaveLength(1);
	});

	it("allows rejecting a proposal", () => {
		const proposal = memory.propose(
			"user1",
			{
				userId: "user1",
				type: "fact",
				value: "Some inferred fact",
				confidence: 0.5,
				sensitivity: "normal",
				visibility: "usable_by_ai",
				expiresAt: null,
			},
			{ system: "gmail" },
			"AI inference",
		);
		expect(proposal.status).toBe("pending");

		memory.reject("user1", proposal.id, "Not accurate");

		expect(() => memory.save("user1", proposal.id)).toThrow(/not pending/);
		expect(memory.search("user1", "inferred")).toHaveLength(0);
	});

	it("allows updating a memory item", () => {
		memory.propose(
			"user1",
			{
				userId: "user1",
				type: "preference",
				subject: "theme",
				value: "I prefer dark mode",
				confidence: 0.9,
				sensitivity: "normal",
				visibility: "usable_by_ai",
				expiresAt: null,
			},
			{ system: "chat" },
			"User stated",
		);

		const item = memory.search("user1", "dark mode")[0];
		if (!item) throw new Error("Expected memory item");
		const updated = memory.update("user1", item.id, {
			value: "I prefer light mode now",
			confidence: 1.0,
		});
		expect(updated.value).toBe("I prefer light mode now");
		expect(updated.confidence).toBe(1.0);
	});
});
