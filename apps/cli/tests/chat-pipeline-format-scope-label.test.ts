import { describe, expect, it } from "bun:test";
import { formatScopeLabel } from "@toby/core/chat-pipeline/format-scope-label";
import type { IntegrationModule } from "@toby/core/integrations/types";

function mockModule(name: string, displayName?: string): IntegrationModule {
	return {
		name,
		displayName: displayName ?? name,
		capabilities: ["chat"],
		isConnected: async () => true,
		getCredentialDescriptors: () => [],
		seedCredentialValues: () => ({}),
		mergeCredentialsPatch: () => ({}),
		chat: async () => {},
	} as IntegrationModule;
}

describe("formatScopeLabel", () => {
	it("returns (none) for empty module list", () => {
		expect(formatScopeLabel([])).toBe("(none)");
	});

	it("joins display names with +", () => {
		expect(
			formatScopeLabel([
				mockModule("custom-a", "Custom A"),
				mockModule("custom-b", "Custom B"),
			]),
		).toBe("Custom A + Custom B");
	});
});
