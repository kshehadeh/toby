import { describe, expect, it } from "vitest";
import {
	getIntegration,
	getIntegrationModule,
	getIntegrationModules,
	getIntegrations,
	getModulesWithCapability,
} from "../src/integrations/index";

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
		for (const cap of ["summarize", "organize", "chat"] as const) {
			for (const mod of getModulesWithCapability(cap)) {
				expect(mod.capabilities).toContain(cap);
			}
		}
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

	it("summarize-capable modules define summarize()", () => {
		for (const mod of getModulesWithCapability("summarize")) {
			expect(typeof mod.summarize).toBe("function");
		}
	});

	it("chat-capable modules define chat()", () => {
		for (const mod of getModulesWithCapability("chat")) {
			expect(typeof mod.chat).toBe("function");
		}
	});

	it("organize-capable modules define organize()", () => {
		for (const mod of getModulesWithCapability("organize")) {
			expect(typeof mod.organize).toBe("function");
		}
	});
});
