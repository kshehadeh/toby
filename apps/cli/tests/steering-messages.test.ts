import type { CoreMessage } from "@toby/core/ai/chat";
import { assembleMessagesNode } from "@toby/core/chat-pipeline/nodes/assemble-messages";
import type { ExpandedTurn } from "@toby/core/chat-pipeline/pipeline";
import { describe, expect, it, vi } from "vitest";
import {
	isFirstSteeringTurn,
	lastUserMessageText,
	priorMessagesForSteeringTurn,
} from "../src/ui/chat/steering-messages";

const priorWithHello: CoreMessage[] = [
	{ role: "system", content: "sys" },
	{ role: "user", content: "hello" },
];

describe("priorMessagesForSteeringTurn", () => {
	it("appends an in-flight user prompt missing from messages", () => {
		const prior: CoreMessage[] = [{ role: "system", content: "sys" }];
		expect(priorMessagesForSteeringTurn(prior, "hello")).toEqual([
			{ role: "system", content: "sys" },
			{ role: "user", content: "hello" },
		]);
	});

	it("does not duplicate a prompt already present in messages", () => {
		expect(priorMessagesForSteeringTurn(priorWithHello, "hello")).toEqual(
			priorWithHello,
		);
	});

	it("ignores blank in-flight prompts", () => {
		expect(priorMessagesForSteeringTurn(priorWithHello, "  ")).toEqual(
			priorWithHello,
		);
	});
});

describe("isFirstSteeringTurn", () => {
	it("is true when no user messages exist yet", () => {
		expect(isFirstSteeringTurn([{ role: "system", content: "sys" }])).toBe(
			true,
		);
	});

	it("is false once a user message is present", () => {
		expect(isFirstSteeringTurn(priorWithHello)).toBe(false);
	});
});

describe("steering assembled messages", () => {
	it("includes the steering prompt as the last user message", async () => {
		const prior = priorMessagesForSteeringTurn(
			[{ role: "system", content: "sys" }],
			"hello",
		);
		const steering = "check my email instead";
		const expanded: ExpandedTurn = {
			rawUserText: steering,
			priorMessages: prior,
			isFirstTurn: isFirstSteeringTurn(prior),
			localSkills: [],
			toolCatalog: {
				catalogText: "(none)",
				allowedToolNamesLower: new Set(),
				allToolNames: [],
				toolIntegrationLabels: {},
			},
			willPretreat: false,
			integrationLabel: "Gmail",
			routingIndex: null,
			effectiveText: steering,
			spec: null,
			prepId: null,
		};

		const assembled = await assembleMessagesNode.run(expanded, {
			persona: {
				name: "Default",
				instructions: "",
				ai: { provider: "openai", model: "gpt-4o-mini" },
			},
			modules: [],
			dryRun: true,
			emit: vi.fn(),
			nextSeq: () => 1,
			emitPersistLifecycle: false,
		});

		expect(lastUserMessageText(assembled.messages)).toBe(steering);
		expect(assembled.messages).toEqual([
			{ role: "system", content: "sys" },
			{ role: "user", content: "hello" },
			{ role: "user", content: steering },
		]);
	});
});
