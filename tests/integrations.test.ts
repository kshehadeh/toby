import { describe, expect, it } from "vitest";
import {
	getIntegration,
	getIntegrationModule,
	getIntegrationModules,
	getIntegrations,
	getModulesForCategory,
	getModulesWithCapability,
} from "../src/integrations/index";
import { ALL_PROVIDER_CATEGORIES } from "../src/integrations/types";

describe("getIntegrations", () => {
	it("returns at least one integration", () => {
		const integrations = getIntegrations();
		expect(integrations.length).toBeGreaterThan(0);
	});

	it("all integrations have stable identity fields", () => {
		const integrations = getIntegrations();
		for (const i of integrations) {
			expect(i.name).toMatch(/^[a-z0-9_-]+$/);
			expect(i.displayName.trim().length).toBeGreaterThan(0);
			expect(i.description.trim().length).toBeGreaterThan(0);
		}
	});
});

describe("getIntegration", () => {
	it("returns undefined for unknown integration", () => {
		const unknown = getIntegration("nonexistent");
		expect(unknown).toBeUndefined();
	});
});

describe("integration registry", () => {
	it("getIntegrationModule matches getIntegration", () => {
		for (const m of getIntegrationModules()) {
			expect(getIntegrationModule(m.name)).toEqual(getIntegration(m.name));
		}
	});

	it("getIntegrationModules lists at least one module", () => {
		const names = getIntegrationModules()
			.map((m) => m.name)
			.sort();
		expect(names.length).toBeGreaterThan(0);
	});

	it("getModulesWithCapability returns modules that declare that capability", () => {
		for (const mod of getModulesWithCapability("chat")) {
			expect(mod.capabilities).toContain("chat");
		}
	});

	it("includes slack in registry with chat provider category", () => {
		const slack = getIntegrationModule("slack");
		expect(slack).toBeDefined();
		expect(slack?.providerCategories).toContain("chat");
		expect(slack?.capabilities).toContain("chat");
	});

	it("includes macos in registry with chat capability", () => {
		const macos = getIntegrationModule("macos");
		expect(macos).toBeDefined();
		expect(macos?.name).toBe("macos");
		expect(macos?.capabilities).toContain("chat");
		expect(typeof macos?.createChatTools).toBe("function");
	});

	it("ALL_PROVIDER_CATEGORIES includes chat", () => {
		expect(ALL_PROVIDER_CATEGORIES).toContain("chat");
	});

	it("getModulesForCategory(chat) includes slack", () => {
		const names = getModulesForCategory("chat").map((m) => m.name);
		expect(names).toContain("slack");
	});

	it("modules expose credential descriptors", () => {
		for (const mod of getIntegrationModules()) {
			const descriptors = mod.getCredentialDescriptors();
			expect(descriptors.length).toBeGreaterThan(0);
			for (const d of descriptors) {
				expect(d.key).toMatch(/^[a-z]+\./);
			}
		}
	});

	it("chat-capable modules define chat()", () => {
		for (const mod of getModulesWithCapability("chat")) {
			expect(typeof mod.chat).toBe("function");
		}
	});
});
