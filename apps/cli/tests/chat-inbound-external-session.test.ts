import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	closeChatDbForTests,
	getOrCreateExternalSession,
	loadExternalSession,
	markMessageProcessed,
	setPendingAskUser,
	wasMessageProcessed,
} from "@toby/core/session-store";
import { afterEach, describe, expect, it } from "bun:test";

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
});
