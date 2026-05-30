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

	it("ALL_PROVIDER_CATEGORIES includes search", () => {
		expect(ALL_PROVIDER_CATEGORIES).toContain("search");
	});

	it("getModulesForCategory(chat) includes slack", () => {
		const names = getModulesForCategory("chat").map((m) => m.name);
		expect(names).toContain("slack");
	});

	it("modules expose namespaced credential descriptors when needed", () => {
		for (const mod of getIntegrationModules()) {
			const descriptors = mod.getCredentialDescriptors();
			for (const d of descriptors) {
				expect(d.key).toMatch(/^[a-z]+\./);
			}
		}
	});

	it("includes bravesearch in registry with search provider category", () => {
		const brave = getIntegrationModule("bravesearch");
		expect(brave).toBeDefined();
		expect(brave?.providerCategories).toContain("search");
		expect(brave?.capabilities).toContain("chat");
	});

	it("getModulesForCategory(search) includes bravesearch", () => {
		const names = getModulesForCategory("search").map((m) => m.name);
		expect(names).toContain("bravesearch");
	});

	it("includes jira in registry with work_tracker provider category", () => {
		const jira = getIntegrationModule("jira");
		expect(jira).toBeDefined();
		expect(jira?.providerCategories).toContain("work_tracker");
		expect(jira?.capabilities).toContain("chat");
		expect(jira?.resources).toContain("issues");
		expect(jira?.resources).toContain("projects");
	});

	it("getModulesForCategory(work_tracker) includes jira", () => {
		const names = getModulesForCategory("work_tracker").map((m) => m.name);
		expect(names).toContain("jira");
	});

	it("jira credential descriptors include domain, email, apiToken", () => {
		const jira = getIntegrationModule("jira");
		expect(jira).toBeDefined();
		const keys = jira?.getCredentialDescriptors().map((d) => d.key);
		expect(keys).toContain("jira.domain");
		expect(keys).toContain("jira.email");
		expect(keys).toContain("jira.apiToken");
	});

	it("ALL_PROVIDER_CATEGORIES includes work_tracker", () => {
		expect(ALL_PROVIDER_CATEGORIES).toContain("work_tracker");
	});

	it("chat-capable modules define chat()", () => {
		for (const mod of getModulesWithCapability("chat")) {
			expect(typeof mod.chat).toBe("function");
		}
	});
});
