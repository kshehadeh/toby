import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	appendTranscriptBatch: vi.fn(),
	renameChatSession: vi.fn(),
	loadChatSession: vi.fn(),
	getSessionLastPretreatment: vi.fn(),
	runChatTurnPipeline: vi.fn(),
	resolveHeadlessChatModules: vi.fn(),
	insertTurnWorkSummary: vi.fn(),
	applyEvent: vi.fn(),
	addUser: vi.fn(),
	addAssistantFallback: vi.fn(),
	hasAssistantBodyInSlice: vi.fn(),
	snapshot: vi.fn(),
}));

vi.mock("@toby/core/session-store", async () => {
	const actual = await vi.importActual("@toby/core/session-store");
	return {
		...(actual as object),
		appendTranscriptBatch: mocks.appendTranscriptBatch,
		renameChatSession: mocks.renameChatSession,
		loadChatSession: mocks.loadChatSession,
		getSessionLastPretreatment: mocks.getSessionLastPretreatment,
	};
});

vi.mock("@toby/core/chat-pipeline/pipeline", async () => {
	const actual = await vi.importActual("@toby/core/chat-pipeline/pipeline");
	return {
		...(actual as object),
		runChatTurnPipeline: mocks.runChatTurnPipeline,
	};
});

vi.mock("@toby/core/chat-pipeline/resolve-chat-modules", () => ({
	resolveHeadlessChatModules: mocks.resolveHeadlessChatModules,
}));

vi.mock("@toby/core/chat-pipeline/transcript-accumulator", () => ({
	TranscriptAccumulator: vi.fn().mockImplementation(() => ({
		applyEvent: mocks.applyEvent,
		addUser: mocks.addUser,
		addAssistantFallback: mocks.addAssistantFallback,
		hasAssistantBodyInSlice: mocks.hasAssistantBodyInSlice,
		get snapshot() {
			return mocks.snapshot();
		},
	})),
}));

vi.mock("@toby/core/chat-pipeline/turn-work-summary", () => ({
	insertTurnWorkSummary: mocks.insertTurnWorkSummary,
}));

import { runHeadlessChatTurn } from "@toby/core/chat-pipeline/headless-session";

const basePersona = {
	name: "Toby",
	instructions: "",
	ai: { provider: "openai", model: "gpt-4.1" } as const,
};

describe("runHeadlessChatTurn", () => {
	beforeEach(() => {
		mocks.loadChatSession.mockReturnValue({
			id: "sess-1",
			name: "New chat",
			messages: [],
			transcript: [],
			settings: {},
		});
		mocks.getSessionLastPretreatment.mockReturnValue(null);
		mocks.resolveHeadlessChatModules.mockResolvedValue({
			modules: [],
			warnings: [],
		});
		mocks.applyEvent.mockImplementation(() => {});
		mocks.addUser.mockImplementation(() => {});
		mocks.addAssistantFallback.mockImplementation(() => {});
		mocks.hasAssistantBodyInSlice.mockReturnValue(false);
		mocks.snapshot.mockReturnValue([
			{ kind: "user", text: "hello" },
			{ kind: "assistant", text: "hi" },
		]);
		mocks.insertTurnWorkSummary.mockImplementation((entries) => entries);
		mocks.runChatTurnPipeline.mockResolvedValue({
			stage: "persist",
			turn: {
				rawUserText: "hello",
				text: "hi",
				toolCalls: [],
				appliedActions: [],
				responseMessages: [{ role: "assistant", content: "hi" }],
				spec: { sessionName: "Hello World" },
			},
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("persists the transcript and renames the session on success", async () => {
		const result = await runHeadlessChatTurn({
			inboundModule: {
				name: "slack",
				displayName: "Slack",
				capabilities: ["inbound"],
			} as never,
			sessionId: "sess-1",
			userText: "hello",
			persona: basePersona,
			dryRun: false,
		});

		expect(result.text).toBe("hi");
		expect(mocks.addUser).toHaveBeenCalledWith("hello");
		expect(mocks.renameChatSession).toHaveBeenCalledWith(
			"sess-1",
			"Hello World",
		);
		expect(mocks.appendTranscriptBatch).toHaveBeenCalled();
		const [, startIdx, entries] = mocks.appendTranscriptBatch.mock.calls[0] as [
			string,
			number,
			unknown[],
		];
		expect(startIdx).toBe(0);
		expect(entries).toHaveLength(2);
	});

	it("adds an assistant fallback when the pipeline text is not already in the transcript", async () => {
		mocks.hasAssistantBodyInSlice.mockReturnValue(false);
		await runHeadlessChatTurn({
			inboundModule: {
				name: "slack",
				displayName: "Slack",
				capabilities: ["inbound"],
			} as never,
			sessionId: "sess-1",
			userText: "hello",
			persona: basePersona,
			dryRun: false,
		});
		expect(mocks.addAssistantFallback).toHaveBeenCalledWith("Toby", "hi");
	});

	it("does not add a fallback when the assistant body is already present", async () => {
		mocks.hasAssistantBodyInSlice.mockReturnValue(true);
		await runHeadlessChatTurn({
			inboundModule: {
				name: "slack",
				displayName: "Slack",
				capabilities: ["inbound"],
			} as never,
			sessionId: "sess-1",
			userText: "hello",
			persona: basePersona,
			dryRun: false,
		});
		expect(mocks.addAssistantFallback).not.toHaveBeenCalled();
	});
});
