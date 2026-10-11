import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as actualChat from "@toby/core/ai/chat";
import * as actualModules from "@toby/core/chat-pipeline/resolve-chat-modules";

const chat = mock(async (..._args: unknown[]) => ({ text: "Done" }));
mock.module("@toby/core/ai/chat", () => ({
	...actualChat,
	chatWithTools: chat,
	createModelForPersona: () => ({}),
}));
mock.module("@toby/core/chat-pipeline/resolve-chat-modules", () => ({
	...actualModules,
	resolveWebChatModules: async () => ({ modules: [], warnings: [] }),
}));
const { runAgentTaskNode } = await import("@toby/core/flows/nodes/agent-task");
const { closeChatDbForTests } = await import("@toby/core/session-store");
const { closeMemoryDb } = await import("@toby/core/memory/memory-store");
let prior: string | undefined;
let dir: string;
beforeEach(() => {
	prior = process.env.TOBY_DIR;
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-agent-flow-"));
	process.env.TOBY_DIR = dir;
	chat.mockClear();
});
afterEach(() => {
	closeChatDbForTests();
	closeMemoryDb();
	if (prior === undefined) Reflect.deleteProperty(process.env, "TOBY_DIR");
	else process.env.TOBY_DIR = prior;
	fs.rmSync(dir, { recursive: true, force: true });
});
describe("Flow Agent Task", () => {
	it("runs without connected integrations and excludes interactive tools", async () => {
		const signal = new AbortController().signal;
		const result = await runAgentTaskNode(
			{
				id: "task",
				type: "agent_task",
				userPrompt: () => "Say hello",
				systemPrompt: "Be concise",
			},
			{},
			{
				persona: {
					name: "Test",
					instructions: "Follow instructions",
					promptMode: "add",
					ai: { provider: "ollama", model: "test" },
				},
				bag: {},
				abortSignal: signal,
			},
		);
		expect(result.object.markdown).toBe("Done");
		const args = chat.mock.calls[0];
		expect(args[1]).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ role: "user", content: "Say hello" }),
			]),
		);
		expect(JSON.stringify(args[1])).toContain("Be concise");
		expect(args[2]).not.toHaveProperty("askUser");
		expect(args[3]).toMatchObject({ abortSignal: signal });
		expect(result.detail.kind).toBe("agent_task");
	});
});
