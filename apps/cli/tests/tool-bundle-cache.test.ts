import { afterEach, describe, expect, it, jest, mock, spyOn } from "bun:test";
import * as chatModule from "@toby/core/ai/chat";
import {
	buildToolsCatalogForPretreatment,
	clearSessionToolBundleCache,
	runIntegrationChatTurn,
	runSharedChatTurn,
} from "@toby/core/chat-pipeline/run-turn";
import type { Persona } from "@toby/core/config/index";
import type { IntegrationModule } from "@toby/core/integrations/types";
import { MEMORY_POLICY } from "@toby/core/memory/instructions";
import { tool } from "ai";
import { z } from "zod";

afterEach(() => {
	jest.restoreAllMocks();
});

const persona: Persona = {
	name: "Default",
	instructions: "",
	ai: { provider: "openai", model: "gpt-4.1" },
};

function mockModule(name: string): IntegrationModule {
	const createChatTools = mock(async () => ({
		tools: {
			[`${name}Tool`]: tool({
				description: `${name} tool`,
				inputSchema: z.object({}),
				execute: async () => ({}),
			}),
		},
		appliedActions: [] as string[],
	}));
	return {
		name,
		displayName: name,
		createChatTools,
	} as unknown as IntegrationModule;
}

describe("session tool bundle cache", () => {
	afterEach(() => {
		clearSessionToolBundleCache();
		jest.restoreAllMocks();
	});

	it("passes memory policy and write tools to the model when routing selects no tools", async () => {
		spyOn(chatModule, "createModelForPersona").mockReturnValue(
			{} as ReturnType<typeof chatModule.createModelForPersona>,
		);
		const modelCall = spyOn(chatModule, "chatWithTools").mockResolvedValue({
			text: "ok",
			toolResults: [],
			toolCalls: [],
			responseMessages: [],
		});

		for (const modules of [[], [mockModule("alpha")]]) {
			await runSharedChatTurn(
				modules,
				[
					{ role: "system", content: "Existing session instructions." },
					{ role: "user", content: "Remember my project is Northstar." },
				],
				{ persona, dryRun: true, relevantTools: [] },
			);
			const args = modelCall.mock.calls.at(-1);
			expect(args?.[1][0]?.content).toContain(MEMORY_POLICY);
			for (const name of ["memorySearch", "memoryPropose", "memorySave"]) {
				expect(args?.[2][name]).toBeDefined();
				expect(args?.[3]?.activeTools).toContain(name);
			}
		}
	});

	it("reuses integration tools across pretreatment calls in the same session", async () => {
		const mod = mockModule("alpha");
		await buildToolsCatalogForPretreatment([mod], { dryRun: true, persona });
		await buildToolsCatalogForPretreatment([mod], { dryRun: true, persona });
		expect(mod.createChatTools).toHaveBeenCalledTimes(1);
	});

	it("invalidates when scope modules change", async () => {
		const alpha = mockModule("alpha");
		const beta = mockModule("beta");
		await buildToolsCatalogForPretreatment([alpha], { dryRun: true, persona });
		clearSessionToolBundleCache();
		await buildToolsCatalogForPretreatment([beta], { dryRun: true, persona });
		expect(alpha.createChatTools).toHaveBeenCalledTimes(1);
		expect(beta.createChatTools).toHaveBeenCalledTimes(1);
	});

	it("runSharedChatTurn skips createChatTools when prebuilt catalog is provided", async () => {
		const mod = mockModule("alpha");
		const catalog = await buildToolsCatalogForPretreatment([mod], {
			dryRun: true,
			persona,
		});
		expect(mod.createChatTools).toHaveBeenCalledTimes(1);

		spyOn(chatModule, "createModelForPersona").mockReturnValue(
			{} as ReturnType<typeof chatModule.createModelForPersona>,
		);
		spyOn(chatModule, "chatWithTools").mockResolvedValue({
			text: "ok",
			toolResults: [],
			toolCalls: [],
			responseMessages: [],
		});

		await runSharedChatTurn([mod], [{ role: "user", content: "hi" }], {
			persona,
			dryRun: true,
			prebuiltToolCatalog: catalog,
		});

		expect(mod.createChatTools).toHaveBeenCalledTimes(1);
	});

	it("runIntegrationChatTurn succeeds with no integrations selected", async () => {
		spyOn(chatModule, "createModelForPersona").mockReturnValue(
			{} as ReturnType<typeof chatModule.createModelForPersona>,
		);
		spyOn(chatModule, "chatWithTools").mockResolvedValue({
			text: "I do not have any integrations connected yet.",
			toolResults: [],
			toolCalls: [],
			responseMessages: [],
		});

		const result = await runIntegrationChatTurn(
			[],
			[{ role: "user", content: "hello" }],
			{ persona, dryRun: false },
		);

		expect(result.text).toBe("I do not have any integrations connected yet.");
		expect(result.toolCalls).toHaveLength(0);
	});
});
