import { describe, expect, it } from "vitest";
import { formatScopeLabel } from "../src/chat-pipeline/format-scope-label";
import type { IntegrationModule } from "../src/integrations/types";

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
