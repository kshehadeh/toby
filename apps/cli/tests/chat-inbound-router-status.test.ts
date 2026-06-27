import type { InboundStatusReporter } from "@toby/core/chat-inbound/types";
import type { IntegrationModule } from "@toby/core/integrations/types";
import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import * as actualHeadlessSession from "@toby/core/chat-pipeline/headless-session";
import * as actualSessionStore from "@toby/core/session-store";
import * as actualAskUserBridge from "@toby/core/chat-inbound/ask-user-bridge";
import * as actualMutex from "@toby/core/chat-inbound/mutex";

let runHeadlessChatTurnReturn: unknown = {
	text: "Hello",
	deliveredViaTools: false,
	appliedActions: [],
	responseMessages: [],
};
let runHeadlessChatTurnReject: Error | undefined;
const mockRunHeadlessChatTurn = mock(() => {
	if (runHeadlessChatTurnReject) return Promise.reject(runHeadlessChatTurnReject);
	return Promise.resolve(runHeadlessChatTurnReturn);
});

let getOrCreateExternalSessionReturn: unknown = {
	sessionId: "sess-1",
	displayName: "Test",
	metadata: {},
};
const mockGetOrCreateExternalSession = mock(() => getOrCreateExternalSessionReturn);

let loadExternalSessionReturn: unknown = null;
const mockLoadExternalSession = mock(() => loadExternalSessionReturn);

let wasMessageProcessedReturn = false;
const mockWasMessageProcessed = mock(() => wasMessageProcessedReturn);

const mockMarkMessageProcessed = mock(() => {});

let createAskUserBridgeReturn: unknown = () => {};
const mockCreateAskUserBridge = mock(() => createAskUserBridgeReturn);

const mockWithConversationMutex = mock(
	async (_key: string, fn: () => Promise<void>) => fn(),
);

mock.module("@toby/core/chat-pipeline/headless-session", () => ({
	runHeadlessChatTurn: mockRunHeadlessChatTurn,
}));

mock.module("@toby/core/session-store", () => ({
	getOrCreateExternalSession: mockGetOrCreateExternalSession,
	loadExternalSession: mockLoadExternalSession,
	wasMessageProcessed: mockWasMessageProcessed,
	markMessageProcessed: mockMarkMessageProcessed,
}));

mock.module("@toby/core/chat-inbound/ask-user-bridge", () => ({
	createAskUserBridge: mockCreateAskUserBridge,
	tryResolvePendingAskUser: () => {},
}));

mock.module("@toby/core/chat-inbound/mutex", () => ({
	withConversationMutex: mockWithConversationMutex,
}));

mock.module("@toby/core/logging/daemon-log", () => ({
	daemonLog: () => {},
}));

import { handleInboundEvent } from "@toby/core/chat-inbound/router";

describe("handleInboundEvent status reporter", () => {
	const conversation = {
		externalKey: "test:1",
		displayName: "Test",
		metadata: {},
	};

	const mockStatusReporterUpdate = mock(() => {});
	const mockStatusReporterClear = mock(() => Promise.resolve(undefined));

	const statusReporter: InboundStatusReporter = {
		update: mockStatusReporterUpdate,
		clear: mockStatusReporterClear,
	};

	const mockDeliverReply = mock(() => Promise.resolve(undefined));
	const mockDeliverAskUser = mock(() => {});
	const mockCreateStatusReporter = mock(() => statusReporter);
	const mockFormatInboundStatusLine = mock(() => "⏳ _Preparing request…_");
	const mockStart = mock(() => {});

	const module = {
		name: "mock",
		chatInbound: {
			start: mockStart,
			deliverReply: mockDeliverReply,
			deliverAskUser: mockDeliverAskUser,
			createStatusReporter: mockCreateStatusReporter,
			formatInboundStatusLine: mockFormatInboundStatusLine,
		},
	} as unknown as IntegrationModule;

	beforeEach(() => {
		runHeadlessChatTurnReject = undefined;
		runHeadlessChatTurnReturn = {
			text: "Hello",
			deliveredViaTools: false,
			appliedActions: [],
			responseMessages: [],
		};
		wasMessageProcessedReturn = false;
		loadExternalSessionReturn = null;
		getOrCreateExternalSessionReturn = {
			sessionId: "sess-1",
			displayName: "Test",
			metadata: {},
		};
		createAskUserBridgeReturn = () => {};

		mockRunHeadlessChatTurn.mockClear?.();
		mockGetOrCreateExternalSession.mockClear?.();
		mockLoadExternalSession.mockClear?.();
		mockWasMessageProcessed.mockClear?.();
		mockMarkMessageProcessed.mockClear?.();
		mockCreateAskUserBridge.mockClear?.();
		mockWithConversationMutex.mockClear?.();
		mockStatusReporterUpdate.mockClear?.();
		mockStatusReporterClear.mockClear?.();
		mockDeliverReply.mockClear?.();
		mockDeliverAskUser.mockClear?.();
		mockCreateStatusReporter.mockClear?.();
		mockFormatInboundStatusLine.mockClear?.();
		mockStart.mockClear?.();
	});

	it("creates status reporter, forwards progress, and clears before reply", async () => {
		await handleInboundEvent(
			{
				module,
				persona: { name: "T", instructions: "", ai: { model: "m" } },
				dryRun: false,
			},
			{
				integration: "mock",
				externalKey: "test:1",
				messageId: "msg-1",
				text: "hi",
				authorId: "user-1",
				isNewConversationTurn: true,
				conversation,
			},
		);

		expect(module.chatInbound?.createStatusReporter).toHaveBeenCalledWith({
			conversation,
			dryRun: false,
		});
		expect(mockRunHeadlessChatTurn).toHaveBeenCalledWith(
			expect.objectContaining({
				onProgress: expect.any(Function),
			}),
		);
		const onProgress = mockRunHeadlessChatTurn.mock.calls[0]?.[0]?.onProgress as
			| ((event: { type: string }) => void)
			| undefined;
		onProgress?.({ type: "prep_start", id: "p1", seq: 1, header: "Expand" });
		expect(module.chatInbound?.formatInboundStatusLine).toHaveBeenCalled();
		expect(statusReporter.update).toHaveBeenCalledWith(
			"⏳ _Preparing request…_",
		);
		expect(statusReporter.clear).toHaveBeenCalled();
		expect(mockDeliverReply).toHaveBeenCalled();
		expect(mockDeliverReply).toHaveBeenCalledWith({
			conversation,
			text: "Hello",
			dryRun: false,
		});
	});

	it("clears status reporter on turn failure before error reply", async () => {
		runHeadlessChatTurnReject = new Error("boom");

		await handleInboundEvent(
			{
				module,
				persona: { name: "T", instructions: "", ai: { model: "m" } },
				dryRun: false,
			},
			{
				integration: "mock",
				externalKey: "test:1",
				messageId: "msg-2",
				text: "hi",
				authorId: "user-1",
				isNewConversationTurn: true,
				conversation,
			},
		);

		expect(statusReporter.clear).toHaveBeenCalled();
		expect(module.chatInbound?.deliverReply).toHaveBeenCalledWith(
			expect.objectContaining({
				text: expect.stringContaining("Sorry, I hit an error"),
			}),
		);
	});

	afterAll(() => {
		mock.module("@toby/core/chat-pipeline/headless-session", () => actualHeadlessSession);
		mock.module("@toby/core/session-store", () => actualSessionStore);
		mock.module("@toby/core/chat-inbound/ask-user-bridge", () => actualAskUserBridge);
		mock.module("@toby/core/chat-inbound/mutex", () => actualMutex);
	});
});
