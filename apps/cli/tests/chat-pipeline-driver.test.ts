import type { CoreMessage } from "@toby/core/ai/chat";
import { assembleMessagesNode } from "@toby/core/chat-pipeline/nodes/assemble-messages";
import { expandPromptNode } from "@toby/core/chat-pipeline/nodes/expand-prompt";
import { persistTurnNode } from "@toby/core/chat-pipeline/nodes/persist-turn";
import { runModelTurnNode } from "@toby/core/chat-pipeline/nodes/run-model-turn";
import { turnInitNode } from "@toby/core/chat-pipeline/nodes/turn-init";
import {
	type AssembledTurn,
	type TurnContext,
	type TurnRequest,
	runChatTurnPipeline,
	withAssembledMessages,
} from "@toby/core/chat-pipeline/pipeline";
import { describe, expect, it, vi } from "vitest";

const request: TurnRequest = {
	rawUserText: "hello",
	priorMessages: [],
	isFirstTurn: true,
};

const inited = {
	...request,
	localSkills: [],
	toolCatalog: {
		catalogText: "(none)",
		allowedToolNamesLower: new Set<string>(),
		allToolNames: [],
		toolIntegrationLabels: {},
	},
	willPretreat: false,
	integrationLabel: "Gmail",
};

const expanded = {
	...inited,
	effectiveText: "hello",
	spec: null,
	prepId: null,
};

const assembled: AssembledTurn = {
	...expanded,
	messages: [{ role: "user", content: "hello" }] as CoreMessage[],
};

const ran = {
	...assembled,
	text: "hi",
	toolCalls: [],
	appliedActions: [],
	responseMessages: [{ role: "assistant", content: "hi" }] as CoreMessage[],
};

const ctx: TurnContext = {
	persona: {
		name: "Default",
		instructions: "",
		ai: { provider: "openai", model: "gpt-4.1" },
	},
	modules: [],
	dryRun: true,
	emit: vi.fn(),
	nextSeq: () => 1,
	emitPersistLifecycle: false,
};

describe("runChatTurnPipeline", () => {
	it("stops after assemble when requested", async () => {
		vi.spyOn(turnInitNode, "run").mockResolvedValue(inited);
		vi.spyOn(expandPromptNode, "run").mockResolvedValue(expanded);
		vi.spyOn(assembleMessagesNode, "run").mockResolvedValue(assembled);
		const runSpy = vi.spyOn(runModelTurnNode, "run");

		const result = await runChatTurnPipeline(request, ctx, {
			stopAfter: "assemble",
		});

		expect(result.stage).toBe("assemble");
		if (result.stage === "assemble") {
			expect(result.turn.messages).toHaveLength(1);
		}
		expect(runSpy).not.toHaveBeenCalled();
	});

	it("runs from an assembled turn through persist", async () => {
		vi.spyOn(runModelTurnNode, "run").mockResolvedValue(ran);
		vi.spyOn(persistTurnNode, "run").mockResolvedValue({
			...ran,
			messagesAfterTurn: [...assembled.messages, ...ran.responseMessages],
		});
		const initSpy = vi.spyOn(turnInitNode, "run");

		const result = await runChatTurnPipeline(request, ctx, { assembled });

		expect(result.stage).toBe("persist");
		expect(initSpy).not.toHaveBeenCalled();
	});
});

describe("withAssembledMessages", () => {
	it("replaces messages while preserving metadata", () => {
		const next = withAssembledMessages(assembled, [
			{ role: "user", content: "updated" },
		]);
		expect(next.messages[0]).toEqual({ role: "user", content: "updated" });
		expect(next.rawUserText).toBe("hello");
	});
});
