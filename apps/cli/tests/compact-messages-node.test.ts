import { afterEach, describe, expect, it, mock } from "bun:test";
import type { CoreMessage } from "@toby/core/ai/chat";
import { compactMessagesNode } from "@toby/core/chat-pipeline/nodes/compact-messages";
import type {
	AssembledTurn,
	TurnContext,
} from "@toby/core/chat-pipeline/pipeline";

afterEach(() => {
	Reflect.deleteProperty(process.env, "TOBY_DISABLE_COMPACTION");
});

function baseAssembled(messages: CoreMessage[]): AssembledTurn {
	return {
		rawUserText: "hi",
		priorMessages: [],
		isFirstTurn: false,
		localSkills: [],
		toolCatalog: {
			catalogText: "(none)",
			allowedToolNamesLower: new Set<string>(),
			allToolNames: [],
			toolIntegrationLabels: {},
		},
		willPretreat: false,
		integrationLabel: "Gmail",
		routingIndex: null,
		effectiveText: "hi",
		spec: null,
		prepId: null,
		messages,
	};
}

function baseCtx(overrides?: Partial<TurnContext>): TurnContext {
	return {
		persona: {
			name: "Default",
			instructions: "",
			ai: { provider: "openai", model: "gpt-4.1" },
		},
		modules: [],
		dryRun: true,
		emit: mock(),
		nextSeq: (() => {
			let n = 0;
			return () => {
				n += 1;
				return n;
			};
		})(),
		emitPersistLifecycle: false,
		...overrides,
	};
}

describe("compactMessagesNode", () => {
	it("no-ops when disabled via env", async () => {
		process.env.TOBY_DISABLE_COMPACTION = "1";
		const huge = "x".repeat(500_000);
		const messages: CoreMessage[] = [
			{ role: "system", content: "sys" },
			{ role: "user", content: "go" },
			{ role: "assistant", content: huge },
		];
		const input = baseAssembled(messages);
		const emit = mock();
		const out = await compactMessagesNode.run(input, baseCtx({ emit }));
		expect(out.messages).toBe(messages);
		expect(emit).not.toHaveBeenCalled();
	});

	it("no-ops when under budget", async () => {
		const messages: CoreMessage[] = [
			{ role: "system", content: "sys" },
			{ role: "user", content: "hello" },
		];
		const input = baseAssembled(messages);
		const emit = mock();
		const out = await compactMessagesNode.run(input, baseCtx({ emit }));
		expect(out.messages).toEqual(messages);
		expect(emit).not.toHaveBeenCalled();
	});
});
