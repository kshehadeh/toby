import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	getIntegration,
	getIntegrationModule,
	getIntegrationModules,
	getIntegrations,
	getModulesForCategory,
	getModulesWithCapability,
	isBuiltinIntegration,
} from "@toby/core/integrations/index";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import { ALL_PROVIDER_CATEGORIES } from "@toby/core/integrations/types";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const slackCli = path.join(repoRoot, "../plugin-slack/src/cli.ts");

function writeSlackPluginWrapper(pluginDir: string): void {
	fs.mkdirSync(pluginDir, { recursive: true });
	const wrapperPath = path.join(pluginDir, "toby-plugin-slack");
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(slackCli)} "$@"\n`;
	fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
}

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
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-integ-registry-"));
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		resetPluginModuleCache();
		writeSlackPluginWrapper(path.join(tempDir, "toby-home", "plugins"));
	});

	afterEach(() => {
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		resetPluginModuleCache();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

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

	it("does not treat slack as a built-in integration", () => {
		expect(isBuiltinIntegration("slack")).toBe(false);
	});

	it("does not treat macos as a built-in integration", () => {
		expect(isBuiltinIntegration("macos")).toBe(false);
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

	it("does not treat websearch as a built-in integration", () => {
		expect(isBuiltinIntegration("websearch")).toBe(false);
		expect(isBuiltinIntegration("bravesearch")).toBe(false);
	});

	it("does not treat jira as a built-in integration", () => {
		expect(isBuiltinIntegration("jira")).toBe(false);
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
