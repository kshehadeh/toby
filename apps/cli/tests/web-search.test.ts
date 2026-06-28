import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
	createWebSearchGlobalTools,
	isWebSearchAvailable,
} from "@toby/core/ai/web-search-global-tools";
import {
	WEB_SEARCH_PROVIDERS,
	getWebSearchProvider,
	listWebSearchProviderIds,
} from "@toby/core/ai/web-search-providers";
import { readConfig, writeConfig } from "@toby/core/config/index";
import { readCredentials, writeCredentials } from "@toby/core/config/index";
import { resolveTobyDir } from "@toby/core/config/index";
import {
	applyConfigureValuesPatch,
	seedConfigureValues,
} from "@toby/core/configure/persistence";

const TOBY_DIR = resolveTobyDir();
const CONFIG_PATH = path.join(TOBY_DIR, "config.json");
const CREDS_PATH = path.join(TOBY_DIR, "credentials.json");

const GATEWAY_PERSONA = {
	name: "TestGateway",
	instructions: "test",
	promptMode: "add" as const,
	ai: { provider: "vercel", model: "openai/gpt-4.1-mini" },
};

const OPENAI_PERSONA = {
	name: "TestOpenAI",
	instructions: "test",
	promptMode: "add" as const,
	ai: { provider: "openai", model: "gpt-4.1-mini" },
};

function backupFiles(): { config: string; creds: string } | null {
	const configExists = fs.existsSync(CONFIG_PATH);
	const credsExists = fs.existsSync(CREDS_PATH);
	if (!configExists && !credsExists) return null;
	return {
		config: configExists ? fs.readFileSync(CONFIG_PATH, "utf-8") : "",
		creds: credsExists ? fs.readFileSync(CREDS_PATH, "utf-8") : "",
	};
}

function restoreFiles(backup: { config: string; creds: string } | null) {
	if (!backup) {
		try {
			fs.unlinkSync(CONFIG_PATH);
		} catch {
			/* ignore */
		}
		try {
			fs.unlinkSync(CREDS_PATH);
		} catch {
			/* ignore */
		}
		return;
	}
	if (backup.config) {
		fs.writeFileSync(CONFIG_PATH, backup.config);
	} else {
		try {
			fs.unlinkSync(CONFIG_PATH);
		} catch {
			/* ignore */
		}
	}
	if (backup.creds) {
		fs.writeFileSync(CREDS_PATH, backup.creds);
	} else {
		try {
			fs.unlinkSync(CREDS_PATH);
		} catch {
			/* ignore */
		}
	}
}

describe("web-search-providers", () => {
	it("exports at least one provider", () => {
		expect(WEB_SEARCH_PROVIDERS.length).toBeGreaterThanOrEqual(1);
	});

	it("ai-gateway provider exists", () => {
		const p = getWebSearchProvider("ai-gateway");
		expect(p).toBeDefined();
		expect(p?.displayName).toContain("AI Gateway");
	});

	it("listWebSearchProviderIds includes ai-gateway", () => {
		expect(listWebSearchProviderIds()).toContain("ai-gateway");
	});

	it("getWebSearchProvider returns undefined for unknown id", () => {
		expect(getWebSearchProvider("nonexistent")).toBeUndefined();
	});
});

describe("isWebSearchAvailable", () => {
	let backup: { config: string; creds: string } | null = null;

	beforeEach(() => {
		backup = backupFiles();
	});

	afterEach(() => {
		restoreFiles(backup);
	});

	it("returns false when web search is not configured", () => {
		writeConfig({ integrations: {}, personas: [] });
		writeCredentials({});
		expect(isWebSearchAvailable()).toBe(false);
	});

	it("returns false when enabled but no gateway key", () => {
		writeConfig({
			integrations: {},
			personas: [],
			webSearch: { provider: "ai-gateway", enabled: true },
		});
		writeCredentials({});
		expect(isWebSearchAvailable()).toBe(false);
	});

	it("returns false when gateway key present but web search disabled", () => {
		writeConfig({
			integrations: {},
			personas: [],
			webSearch: { provider: "ai-gateway", enabled: false },
		});
		writeCredentials({ ai: { vercel: { apiKey: "test-key" } } });
		expect(isWebSearchAvailable()).toBe(false);
	});

	it("returns true when enabled + gateway key present (no persona)", () => {
		writeConfig({
			integrations: {},
			personas: [],
			webSearch: { provider: "ai-gateway", enabled: true },
		});
		writeCredentials({ ai: { vercel: { apiKey: "test-key" } } });
		expect(isWebSearchAvailable()).toBe(true);
	});

	it("returns true when enabled + gateway key + gateway persona", () => {
		writeConfig({
			integrations: {},
			personas: [],
			webSearch: { provider: "ai-gateway", enabled: true },
		});
		writeCredentials({ ai: { vercel: { apiKey: "test-key" } } });
		expect(isWebSearchAvailable(GATEWAY_PERSONA)).toBe(true);
	});

	it("returns true when enabled + gateway key + non-gateway persona", () => {
		writeConfig({
			integrations: {},
			personas: [],
			webSearch: { provider: "ai-gateway", enabled: true },
		});
		writeCredentials({ ai: { vercel: { apiKey: "test-key" } } });
		expect(isWebSearchAvailable(OPENAI_PERSONA)).toBe(true);
	});
});

describe("createWebSearchGlobalTools", () => {
	let backup: { config: string; creds: string } | null = null;

	beforeEach(() => {
		backup = backupFiles();
	});

	afterEach(() => {
		restoreFiles(backup);
	});

	it("returns empty record when web search is unavailable", () => {
		writeConfig({ integrations: {}, personas: [] });
		writeCredentials({});
		const tools = createWebSearchGlobalTools({
			persona: GATEWAY_PERSONA,
			dryRun: false,
			appliedActions: [],
		});
		expect(Object.keys(tools)).toHaveLength(0);
	});

	it("returns webSearch tool when available with gateway persona", () => {
		writeConfig({
			integrations: {},
			personas: [],
			webSearch: { provider: "ai-gateway", enabled: true },
		});
		writeCredentials({ ai: { vercel: { apiKey: "test-key" } } });
		const tools = createWebSearchGlobalTools({
			persona: GATEWAY_PERSONA,
			dryRun: false,
			appliedActions: [],
		});
		expect(Object.keys(tools)).toEqual(["webSearch"]);
		expect(tools.webSearch).toBeDefined();
	});

	it("returns webSearch tool when available with non-gateway persona", () => {
		writeConfig({
			integrations: {},
			personas: [],
			webSearch: { provider: "ai-gateway", enabled: true },
		});
		writeCredentials({ ai: { vercel: { apiKey: "test-key" } } });
		const tools = createWebSearchGlobalTools({
			persona: OPENAI_PERSONA,
			dryRun: false,
			appliedActions: [],
		});
		expect(Object.keys(tools)).toEqual(["webSearch"]);
	});
});

describe("webSearch configure persistence", () => {
	let backup: { config: string; creds: string } | null = null;

	beforeEach(() => {
		backup = backupFiles();
	});

	afterEach(() => {
		restoreFiles(backup);
	});

	it("seedConfigureValues seeds default webSearch.provider when no config exists", () => {
		writeConfig({ integrations: {}, personas: [] });
		writeCredentials({});
		const values = seedConfigureValues();
		expect(values["webSearch.provider"]).toBe("ai-gateway");
		expect(values["webSearch.enabled"]).toBe("false");
	});

	it("seedConfigureValues reads webSearch from config when set", () => {
		writeConfig({
			integrations: {},
			personas: [],
			webSearch: { provider: "ai-gateway", enabled: true },
		});
		writeCredentials({});
		const values = seedConfigureValues();
		expect(values["webSearch.provider"]).toBe("ai-gateway");
		expect(values["webSearch.enabled"]).toBe("true");
	});

	it("applyConfigureValuesPatch saves webSearch.enabled when toggled from scratch", () => {
		writeConfig({ integrations: {}, personas: [] });
		writeCredentials({});
		applyConfigureValuesPatch({ "webSearch.enabled": "true" });
		const config = readConfig();
		expect(config.webSearch).toBeDefined();
		expect(config.webSearch?.provider).toBe("ai-gateway");
		expect(config.webSearch?.enabled).toBe(true);
	});

	it("applyConfigureValuesPatch saves webSearch.enabled when toggled from disabled", () => {
		writeConfig({
			integrations: {},
			personas: [],
			webSearch: { provider: "ai-gateway", enabled: false },
		});
		writeCredentials({});
		applyConfigureValuesPatch({ "webSearch.enabled": "true" });
		const config = readConfig();
		expect(config.webSearch?.enabled).toBe(true);
	});

	it("applyConfigureValuesPatch saves both provider and enabled together", () => {
		writeConfig({ integrations: {}, personas: [] });
		writeCredentials({});
		applyConfigureValuesPatch({
			"webSearch.provider": "ai-gateway",
			"webSearch.enabled": "true",
		});
		const config = readConfig();
		expect(config.webSearch).toEqual({
			provider: "ai-gateway",
			enabled: true,
		});
	});

	it("webSearch persists across seedConfigureValues after patch", () => {
		writeConfig({ integrations: {}, personas: [] });
		writeCredentials({});
		applyConfigureValuesPatch({ "webSearch.enabled": "true" });
		const values = seedConfigureValues();
		expect(values["webSearch.enabled"]).toBe("true");
		expect(values["webSearch.provider"]).toBe("ai-gateway");
	});

	it("applyConfigureValuesPatch disables webSearch when set to false", () => {
		writeConfig({
			integrations: {},
			personas: [],
			webSearch: { provider: "ai-gateway", enabled: true },
		});
		writeCredentials({});
		applyConfigureValuesPatch({ "webSearch.enabled": "false" });
		const config = readConfig();
		expect(config.webSearch?.enabled).toBe(false);
	});

	it("applyConfigureValuesPatch accepts Yes/No from native toggle", () => {
		writeConfig({ integrations: {}, personas: [] });
		writeCredentials({});
		applyConfigureValuesPatch({ "webSearch.enabled": "Yes" });
		const config = readConfig();
		expect(config.webSearch?.enabled).toBe(true);

		applyConfigureValuesPatch({ "webSearch.enabled": "No" });
		const config2 = readConfig();
		expect(config2.webSearch?.enabled).toBe(false);
	});
});
