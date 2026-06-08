import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createChatTurnAbortError } from "@toby/core/abort";
import { createPlan, executePlan } from "@toby/core/planning/index";
import {
	closeChatDbForTests,
	createChatSession,
} from "@toby/core/session-store";
import { afterEach, describe, expect, it } from "vitest";

const isBun =
	typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "toby-plan-abort-"));
}

afterEach(() => {
	closeChatDbForTests();
	const dir = process.env.TOBY_DIR;
	if (dir && fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	process.env.TOBY_DIR = undefined;
});

describe.skipIf(!isBun)("executePlan abort", () => {
	it("stops with interrupted when abortSignal is set after runTurn returns", async () => {
		process.env.TOBY_DIR = makeTempDir();
		const session = createChatSession({ name: "test" });
		const plan = createPlan({
			sessionId: session.id,
			goal: "multi-step goal",
			phases: [
				{ label: "Phase 1", description: "First step" },
				{ label: "Phase 2", description: "Second step" },
			],
		});
		const ac = new AbortController();
		let seq = 0;
		const result = await executePlan(plan, {
			sessionId: session.id,
			emitChatEvent: () => {},
			nextSeq: () => {
				seq += 1;
				return seq;
			},
			abortSignal: ac.signal,
			runTurn: async () => {
				ac.abort();
				return { text: "done", responseMessages: [] };
			},
		});
		expect(result.status).toBe("interrupted");
	});

	it("stops with interrupted when runTurn throws abort error", async () => {
		process.env.TOBY_DIR = makeTempDir();
		const session = createChatSession({ name: "test" });
		const plan = createPlan({
			sessionId: session.id,
			goal: "multi-step goal",
			phases: [
				{ label: "Phase 1", description: "First step" },
				{ label: "Phase 2", description: "Second step" },
			],
		});
		let seq = 0;
		const result = await executePlan(plan, {
			sessionId: session.id,
			emitChatEvent: () => {},
			nextSeq: () => {
				seq += 1;
				return seq;
			},
			runTurn: async () => {
				throw createChatTurnAbortError();
			},
		});
		expect(result.status).toBe("interrupted");
	});
});
