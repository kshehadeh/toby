import type { InboundStatusReporter } from "@toby/core/chat-inbound/types";
import type { IntegrationModule } from "@toby/core/integrations/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	runHeadlessChatTurn,
	getOrCreateExternalSession,
	loadExternalSession,
	wasMessageProcessed,
	markMessageProcessed,
	createAskUserBridge,
	withConversationMutex,
} = vi.hoisted(() => ({
	runHeadlessChatTurn: vi.fn(),
	getOrCreateExternalSession: vi.fn(),
	loadExternalSession: vi.fn(),
	wasMessageProcessed: vi.fn(),
	markMessageProcessed: vi.fn(),
	createAskUserBridge: vi.fn(),
	withConversationMutex: vi.fn(),
}));

vi.mock("@toby/core/chat-pipeline/headless-session", () => ({
	runHeadlessChatTurn,
}));

vi.mock("@toby/core/session-store", () => ({
	getOrCreateExternalSession,
	loadExternalSession,
	wasMessageProcessed,
	markMessageProcessed,
}));

vi.mock("@toby/core/chat-inbound/ask-user-bridge", () => ({
	createAskUserBridge,
	tryResolvePendingAskUser: vi.fn(),
}));

vi.mock("@toby/core/chat-inbound/mutex", () => ({
	withConversationMutex,
}));

vi.mock("@toby/core/logging/daemon-log", () => ({
	daemonLog: vi.fn(),
}));

import { handleInboundEvent } from "@toby/core/chat-inbound/router";

describe("handleInboundEvent status reporter", () => {
	const conversation = {
		externalKey: "test:1",
		displayName: "Test",
		metadata: {},
	};

	const statusReporter: InboundStatusReporter = {
		update: vi.fn(),
		clear: vi.fn().mockResolvedValue(undefined),
	};

	const module = {
		name: "mock",
		chatInbound: {
			start: vi.fn(),
			deliverReply: vi.fn().mockResolvedValue(undefined),
			deliverAskUser: vi.fn(),
			createStatusReporter: vi.fn(() => statusReporter),
			formatInboundStatusLine: vi.fn(() => "⏳ _Preparing request…_"),
		},
	} as unknown as IntegrationModule;

	beforeEach(() => {
		vi.clearAllMocks();
		wasMessageProcessed.mockReturnValue(false);
		loadExternalSession.mockReturnValue(null);
		getOrCreateExternalSession.mockReturnValue({
			sessionId: "sess-1",
			displayName: "Test",
			metadata: {},
		});
		createAskUserBridge.mockReturnValue(vi.fn());
		withConversationMutex.mockImplementation(
			async (_key: string, fn: () => Promise<void>) => fn(),
		);
		runHeadlessChatTurn.mockResolvedValue({
			text: "Hello",
			deliveredViaTools: false,
			appliedActions: [],
			responseMessages: [],
		});
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
		expect(runHeadlessChatTurn).toHaveBeenCalledWith(
			expect.objectContaining({
				onProgress: expect.any(Function),
			}),
		);
		const onProgress = runHeadlessChatTurn.mock.calls[0]?.[0]?.onProgress as
			| ((event: { type: string }) => void)
			| undefined;
		onProgress?.({ type: "prep_start", id: "p1", seq: 1, header: "Expand" });
		expect(module.chatInbound?.formatInboundStatusLine).toHaveBeenCalled();
		expect(statusReporter.update).toHaveBeenCalledWith(
			"⏳ _Preparing request…_",
		);
		const deliverReply = module.chatInbound?.deliverReply as ReturnType<
			typeof vi.fn
		>;
		expect(statusReporter.clear).toHaveBeenCalled();
		expect(deliverReply).toHaveBeenCalled();
		expect(statusReporter.clear.mock.invocationCallOrder[0]).toBeLessThan(
			deliverReply.mock.invocationCallOrder[0] ?? 0,
		);
		expect(deliverReply).toHaveBeenCalledWith({
			conversation,
			text: "Hello",
			dryRun: false,
		});
	});

	it("clears status reporter on turn failure before error reply", async () => {
		runHeadlessChatTurn.mockRejectedValue(new Error("boom"));

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
});
