import {
	inferProviderCategoriesFromPrompt,
	resolveChatModulesForPrompt,
} from "@toby/core/chat-pipeline/resolve-chat-modules";
import type { IntegrationModule } from "@toby/core/integrations/types";
import { describe, expect, it } from "bun:test";

function mockModule(
	name: string,
	categories?: IntegrationModule["providerCategories"],
): IntegrationModule {
	return {
		name,
		displayName: name,
		capabilities: ["chat"],
		providerCategories: categories,
		isConnected: async () => true,
		getCredentialDescriptors: () => [],
		seedCredentialValues: () => ({}),
		mergeCredentialsPatch: () => ({}),
		chat: async () => {},
	} as IntegrationModule;
}

describe("resolveChatModulesForPrompt", () => {
	it("infers email from unread emails phrasing", () => {
		expect(
			inferProviderCategoriesFromPrompt("check my unread emails"),
		).toContain("email");
	});

	it("includes email integration for inbox requests", () => {
		const modules = [
			mockModule("gmail", ["email"]),
			mockModule("slack", ["chat"]),
		];
		const { modules: selected } = resolveChatModulesForPrompt(
			"check my unread emails",
			modules,
		);
		expect(selected.map((m) => m.name)).toContain("gmail");
		expect(selected.map((m) => m.name)).not.toContain("slack");
	});

	it("uses all modules when prompt has no category keywords", () => {
		const modules = [
			mockModule("gmail", ["email"]),
			mockModule("slack", ["chat"]),
		];
		const { modules: selected } = resolveChatModulesForPrompt("hello", modules);
		expect(selected).toHaveLength(2);
	});
});
