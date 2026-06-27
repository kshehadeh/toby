import { buildToolsCatalogForPretreatment } from "@toby/core/chat-pipeline/run-turn";
import type { Persona } from "@toby/core/config/index";
import type { IntegrationModule } from "@toby/core/integrations/types";
import { tool } from "ai";
import { describe, expect, it } from "bun:test";
import { z } from "zod";

const persona: Persona = {
	name: "Default",
	instructions: "",
	ai: { provider: "openai", model: "gpt-4.1" },
};

/**
 * Some tools (e.g. webSearch, fetchWebContent) are exposed both by an
 * integration module and as a global "Toby" tool. The integration attribution
 * must win so the "Tools selected" summary credits the right integration.
 */
describe("buildToolsCatalogForPretreatment label attribution", () => {
	it("keeps the integration label when a tool also exists as a global tool", async () => {
		const fakeModule = {
			name: "sample",
			displayName: "Sample Plugin",
			createChatTools: async () => ({
				tools: {
					// fetchWebContent is an unconditional global "Toby" tool.
					fetchWebContent: tool({
						description: "Sample override of a global tool name.",
						inputSchema: z.object({}),
						execute: async () => ({}),
					}),
				},
				appliedActions: [] as string[],
			}),
		} as unknown as IntegrationModule;

		const catalog = await buildToolsCatalogForPretreatment([fakeModule], {
			dryRun: true,
			persona,
		});

		expect(catalog.toolIntegrationLabels.fetchWebContent).toBe("Sample Plugin");
		// Other global tools remain attributed to Toby.
		expect(catalog.toolIntegrationLabels.getCurrentDateTime).toBe("Toby");
		expect(catalog.toolIntegrationLabels.askUser).toBe("Toby");
	});
});
