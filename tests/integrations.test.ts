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

	it("includes gmail", () => {
		const integrations = getIntegrations();
		const names = integrations.map((i) => i.name);
		expect(names).toContain("gmail");
	});
});

describe("getIntegration", () => {
	it("finds gmail by name", () => {
		const gmail = getIntegration("gmail");
		expect(gmail).toBeDefined();
		expect(gmail?.displayName).toBe("Gmail");
	});

	it("returns undefined for unknown integration", () => {
		const unknown = getIntegration("nonexistent");
		expect(unknown).toBeUndefined();
	});
});

describe("integration registry", () => {
	it("getIntegrationModule matches getIntegration", () => {
		expect(getIntegrationModule("gmail")).toEqual(getIntegration("gmail"));
	});

	it("getIntegrationModules lists known modules", () => {
		const names = getIntegrationModules()
			.map((m) => m.name)
			.sort();
		expect(names).toEqual(["gmail", "todoist"]);
	});

	it("getModulesWithCapability(summarize) includes gmail and todoist", () => {
		const names = getModulesWithCapability("summarize")
			.map((m) => m.name)
			.sort();
		expect(names).toEqual(["gmail", "todoist"]);
	});

	it("getModulesWithCapability(organize) includes only gmail", () => {
		const names = getModulesWithCapability("organize").map((m) => m.name);
		expect(names).toEqual(["gmail"]);
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
});
