import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import * as actualAskUserBridge from "@toby/core/chat-inbound/ask-user-bridge";
import * as actualMutex from "@toby/core/chat-inbound/mutex";
import type { InboundStatusReporter } from "@toby/core/chat-inbound/types";
import * as actualHeadlessSession from "@toby/core/chat-pipeline/headless-session";
import type { IntegrationModule } from "@toby/core/integrations/types";
import * as actualDaemonLog from "@toby/core/logging/daemon-log";
import * as actualSessionStore from "@toby/core/session-store";

let runHeadlessChatTurnReturn: unknown = {
	text: "Hello",
	deliveredViaTools: false,
	appliedActions: [],
	responseMessages: [],
};
let runHeadlessChatTurnReject: Error | undefined;
const mockRunHeadlessChatTurn = mock(() => {
	if (runHeadlessChatTurnReject)
		return Promise.reject(runHeadlessChatTurnReject);
	return Promise.resolve(runHeadlessChatTurnReturn);
});

let getOrCreateExternalSessionReturn: unknown = {
	sessionId: "sess-1",
	displayName: "Test",
	metadata: {},
};
const mockGetOrCreateExternalSession = mock(
	() => getOrCreateExternalSessionReturn,
);

let loadExternalSessionReturn: unknown = null;
const mockLoadExternalSession = mock(() => loadExternalSessionReturn);

let wasMessageProcessedReturn = false;
const mockWasMessageProcessed = mock(() => wasMessageProcessedReturn);

const mockMarkMessageProcessed = mock(() => {});
const mockClearPendingAskUser = mock(() => {});
const mockSetSessionLifecycleStatus = mock(() => {});

let createAskUserBridgeReturn: unknown = () => {};
const mockCreateAskUserBridge = mock(() => createAskUserBridgeReturn);

const mockWithConversationMutex = mock(
	async (_key: string, fn: () => Promise<void>) => fn(),
);

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

	beforeAll(() => {
		spyOn(actualHeadlessSession, "runHeadlessChatTurn").mockImplementation(
			mockRunHeadlessChatTurn as any,
		);
		spyOn(actualSessionStore, "getOrCreateExternalSession").mockImplementation(
			mockGetOrCreateExternalSession as any,
		);
		spyOn(actualSessionStore, "loadExternalSession").mockImplementation(
			mockLoadExternalSession as any,
		);
		spyOn(actualSessionStore, "wasMessageProcessed").mockImplementation(
			mockWasMessageProcessed as any,
		);
		spyOn(actualSessionStore, "markMessageProcessed").mockImplementation(
			mockMarkMessageProcessed as any,
		);
		spyOn(actualSessionStore, "clearPendingAskUser").mockImplementation(
			mockClearPendingAskUser as any,
		);
		spyOn(actualSessionStore, "setSessionLifecycleStatus").mockImplementation(
			mockSetSessionLifecycleStatus as any,
		);
		spyOn(actualAskUserBridge, "createAskUserBridge").mockImplementation(
			mockCreateAskUserBridge as any,
		);
		spyOn(actualMutex, "withConversationMutex").mockImplementation(
			mockWithConversationMutex as any,
		);
		spyOn(actualDaemonLog, "daemonLog").mockImplementation(() => {});
	});

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
		mockClearPendingAskUser.mockClear?.();
		mockSetSessionLifecycleStatus.mockClear?.();
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
		(actualHeadlessSession.runHeadlessChatTurn as any).mockRestore?.();
		(actualSessionStore.getOrCreateExternalSession as any).mockRestore?.();
		(actualSessionStore.loadExternalSession as any).mockRestore?.();
		(actualSessionStore.wasMessageProcessed as any).mockRestore?.();
		(actualSessionStore.markMessageProcessed as any).mockRestore?.();
		(actualSessionStore.clearPendingAskUser as any).mockRestore?.();
		(actualSessionStore.setSessionLifecycleStatus as any).mockRestore?.();
		(actualAskUserBridge.createAskUserBridge as any).mockRestore?.();
		(actualMutex.withConversationMutex as any).mockRestore?.();
		(actualDaemonLog.daemonLog as any).mockRestore?.();
	});
});
