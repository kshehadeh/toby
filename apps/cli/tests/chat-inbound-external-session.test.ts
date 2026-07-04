import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	closeChatDbForTests,
	deleteChatSession,
	getOrCreateExternalSession,
	listExternalSessionsForIntegration,
	loadExternalSession,
	markMessageProcessed,
	setPendingAskUser,
	wasMessageProcessed,
} from "@toby/core/session-store";

const isBun =
	typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "toby-test-"));
}

describe.skipIf(!isBun)("chat external sessions", () => {
	afterEach(() => {
		closeChatDbForTests();
		const dir = process.env.TOBY_DIR;
		if (dir && fs.existsSync(dir)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
		process.env.TOBY_DIR = undefined;
	});

	it("creates and loads external session mapping", () => {
		process.env.TOBY_DIR = makeTempDir();
		const record = getOrCreateExternalSession({
			integration: "mock",
			externalKey: "mock:T1:C1:thread1",
			displayName: "Mock #general",
			metadata: { channelId: "C1" },
		});
		expect(record.sessionId).toBeTruthy();
		expect(record.displayName).toBe("Mock #general");

		const again = getOrCreateExternalSession({
			integration: "mock",
			externalKey: "mock:T1:C1:thread1",
			displayName: "Ignored",
			metadata: {},
		});
		expect(again.sessionId).toBe(record.sessionId);
		expect(again.displayName).toBe("Mock #general");
	});

	it("tracks pending askUser and message dedupe", () => {
		process.env.TOBY_DIR = makeTempDir();
		const record = getOrCreateExternalSession({
			integration: "mock",
			externalKey: "mock:T1:C1:thread2",
			displayName: "Mock thread",
			metadata: {},
		});
		setPendingAskUser("mock", record.externalKey, {
			question: "Pick one",
			options: ["A", "B"],
			createdAt: new Date().toISOString(),
		});
		const loaded = loadExternalSession("mock", record.externalKey);
		expect(loaded?.awaitingAskUser?.options).toEqual(["A", "B"]);

		markMessageProcessed("mock", record.externalKey, "msg-1");
		expect(wasMessageProcessed("mock", record.externalKey, "msg-1")).toBe(true);
	});

	it("lists persisted external sessions for an integration with pending askUser", () => {
		process.env.TOBY_DIR = makeTempDir();
		const recordA = getOrCreateExternalSession({
			integration: "slack",
			externalKey: "slack:T1:C1:threadA",
			displayName: "Slack #general",
			metadata: { channelId: "C1" },
		});
		const recordB = getOrCreateExternalSession({
			integration: "slack",
			externalKey: "slack:T1:C2:threadB",
			displayName: "Slack #random",
			metadata: { channelId: "C2" },
		});
		setPendingAskUser("slack", recordB.externalKey, {
			question: "Which option?",
			options: ["X", "Y"],
			createdAt: new Date().toISOString(),
		});
		getOrCreateExternalSession({
			integration: "email",
			externalKey: "email:threadZ",
			displayName: "Email thread",
			metadata: {},
		});

		const slackSessions = listExternalSessionsForIntegration("slack");
		expect(slackSessions).toHaveLength(2);
		const keys = slackSessions.map((s) => s.externalKey).sort();
		expect(keys).toEqual(["slack:T1:C1:threadA", "slack:T1:C2:threadB"].sort());
		const withPending = slackSessions.find(
			(s) => s.externalKey === recordB.externalKey,
		);
		expect(withPending?.awaitingAskUser?.options).toEqual(["X", "Y"]);
		expect(withPending?.displayName).toBe("Slack #random");
		expect(withPending?.metadata).toMatchObject({ channelId: "C2" });

		const withoutPending = slackSessions.find(
			(s) => s.externalKey === recordA.externalKey,
		);
		expect(withoutPending?.awaitingAskUser).toBeNull();

		expect(listExternalSessionsForIntegration("email")).toHaveLength(1);
		expect(listExternalSessionsForIntegration("missing")).toEqual([]);
	});

	it("relinks external session when chat_sessions row was deleted", () => {
		process.env.TOBY_DIR = makeTempDir();
		const record = getOrCreateExternalSession({
			integration: "slack",
			externalKey: "slack:T1:C1:stale",
			displayName: "Slack #general",
			metadata: { channelId: "C1" },
		});
		expect(record.sessionId).toBeTruthy();

		// Simulate user deleting the chat session from the app
		deleteChatSession(record.sessionId);

		// Next inbound message should create a new chat_sessions row
		const relinked = getOrCreateExternalSession({
			integration: "slack",
			externalKey: "slack:T1:C1:stale",
			displayName: "Slack #general",
			metadata: { channelId: "C1" },
		});
		expect(relinked.sessionId).not.toBe(record.sessionId);
		expect(relinked.sessionId).toBeTruthy();
		expect(relinked.externalKey).toBe("slack:T1:C1:stale");

		// The external session mapping should point to the new session
		const loaded = loadExternalSession("slack", "slack:T1:C1:stale");
		expect(loaded?.sessionId).toBe(relinked.sessionId);
	});

	it("deleteChatSession removes external session mapping", () => {
		process.env.TOBY_DIR = makeTempDir();
		const record = getOrCreateExternalSession({
			integration: "slack",
			externalKey: "slack:T1:C1:cleanup",
			displayName: "Slack #general",
			metadata: { channelId: "C1" },
		});
		expect(loadExternalSession("slack", "slack:T1:C1:cleanup")).not.toBeNull();

		deleteChatSession(record.sessionId);

		expect(loadExternalSession("slack", "slack:T1:C1:cleanup")).toBeNull();
	});
});
