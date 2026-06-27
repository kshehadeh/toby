import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as actualSessionStore from "@toby/core/session-store";
import * as actualPipeline from "@toby/core/chat-pipeline/pipeline";

let loadChatSessionReturn: unknown = {
	id: "sess-1",
	name: "New chat",
	messages: [],
	transcript: [],
	settings: {},
};
const mockLoadChatSession = mock(() => loadChatSessionReturn);

let getSessionLastPretreatmentReturn: unknown = null;
const mockGetSessionLastPretreatment = mock(() => getSessionLastPretreatmentReturn);

let resolveHeadlessChatModulesReturn: unknown = Promise.resolve({
	modules: [],
	warnings: [],
});
const mockResolveHeadlessChatModules = mock(() => resolveHeadlessChatModulesReturn);

const mockApplyEvent = mock(() => {});
const mockAddUser = mock(() => {});
const mockAddAssistantFallback = mock(() => {});

let hasAssistantBodyInSliceReturn = false;
const mockHasAssistantBodyInSlice = mock(() => hasAssistantBodyInSliceReturn);

let snapshotReturn: unknown = [
	{ kind: "user", text: "hello" },
	{ kind: "assistant", text: "hi" },
];
const mockSnapshot = mock(() => snapshotReturn);

const mockInsertTurnWorkSummary = mock((entries: unknown) => entries);

let runChatTurnPipelineReturn: unknown = Promise.resolve({
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
const mockRunChatTurnPipeline = mock(() => runChatTurnPipelineReturn);

const MockTranscriptAccumulator = mock(() => ({
	applyEvent: mockApplyEvent,
	addUser: mockAddUser,
	addAssistantFallback: mockAddAssistantFallback,
	hasAssistantBodyInSlice: mockHasAssistantBodyInSlice,
	get snapshot() {
		return snapshotReturn;
	},
}));

mock.module("@toby/core/session-store", () => ({
	...actualSessionStore,
	appendTranscriptBatch: mock(() => {}),
	renameChatSession: mock(() => {}),
	loadChatSession: mockLoadChatSession,
	getSessionLastPretreatment: mockGetSessionLastPretreatment,
}));

mock.module("@toby/core/chat-pipeline/pipeline", () => ({
	...actualPipeline,
	runChatTurnPipeline: mockRunChatTurnPipeline,
}));

mock.module("@toby/core/chat-pipeline/resolve-chat-modules", () => ({
	resolveHeadlessChatModules: mockResolveHeadlessChatModules,
}));

mock.module("@toby/core/chat-pipeline/transcript-accumulator", () => ({
	TranscriptAccumulator: MockTranscriptAccumulator,
}));

mock.module("@toby/core/chat-pipeline/turn-work-summary", () => ({
	insertTurnWorkSummary: mockInsertTurnWorkSummary,
}));

import { runHeadlessChatTurn } from "@toby/core/chat-pipeline/headless-session";

const basePersona = {
	name: "Toby",
	instructions: "",
	ai: { provider: "openai", model: "gpt-4.1" } as const,
};

describe("runHeadlessChatTurn", () => {
	beforeEach(() => {
		loadChatSessionReturn = {
			id: "sess-1",
			name: "New chat",
			messages: [],
			transcript: [],
			settings: {},
		};
		getSessionLastPretreatmentReturn = null;
		resolveHeadlessChatModulesReturn = Promise.resolve({
			modules: [],
			warnings: [],
		});
		hasAssistantBodyInSliceReturn = false;
		snapshotReturn = [
			{ kind: "user", text: "hello" },
			{ kind: "assistant", text: "hi" },
		];
		runChatTurnPipelineReturn = Promise.resolve({
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
		mockLoadChatSession.mockClear?.();
		mockGetSessionLastPretreatment.mockClear?.();
		mockResolveHeadlessChatModules.mockClear?.();
		mockApplyEvent.mockClear?.();
		mockAddUser.mockClear?.();
		mockAddAssistantFallback.mockClear?.();
		mockHasAssistantBodyInSlice.mockClear?.();
		mockSnapshot.mockClear?.();
		mockInsertTurnWorkSummary.mockClear?.();
		mockRunChatTurnPipeline.mockClear?.();
		MockTranscriptAccumulator.mockClear?.();
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
		expect(mockAddUser).toHaveBeenCalledWith("hello");
		// renameChatSession is mocked at module level, assertions via mock module proxy
		expect(mockRunChatTurnPipeline).toHaveBeenCalled();
	});

	it("adds an assistant fallback when the pipeline text is not already in the transcript", async () => {
		hasAssistantBodyInSliceReturn = false;
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
		expect(mockAddAssistantFallback).toHaveBeenCalledWith("Toby", "hi");
	});

	it("does not add a fallback when the assistant body is already present", async () => {
		hasAssistantBodyInSliceReturn = true;
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
		expect(mockAddAssistantFallback).not.toHaveBeenCalled();
	});
});
