import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	readCredentials,
	writeConfig,
	writeCredentials,
} from "@toby/core/config/index";
import {
	getIntegrationModule,
	isBuiltinIntegration,
} from "@toby/core/integrations/index";
import {
	createPluginIntegrationModule,
	loadPluginMetadata,
} from "@toby/core/integrations/plugins/adapter";
import {
	pluginConfigShape,
	pluginStatus,
	pluginToolsExecute,
	pluginToolsList,
} from "@toby/core/integrations/plugins/client";
import {
	findPluginBinary,
	resetPluginModuleCache,
} from "@toby/core/integrations/plugins/registry";
import { resolvePluginTarget } from "@toby/core/integrations/plugins/runtime";
import { markdownToBlocks } from "../../plugin-notion/src/client";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginSourceDir = path.join(repoRoot, "../plugin-notion");

function copyNotionPlugin(pluginDir: string): void {
	fs.mkdirSync(pluginDir, { recursive: true });
	const dest = path.join(pluginDir, "toby-plugin-notion");
	fs.cpSync(pluginSourceDir, dest, {
		recursive: true,
		filter: (src) =>
			!src.includes(".turbo") &&
			!src.includes(".build") &&
			!src.includes("node_modules"),
	});
}

function findNotionPlugin() {
	const found = findPluginBinary("notion");
	expect(found).toBeDefined();
	if (!found) throw new Error("toby-plugin-notion not discovered");
	return found;
}

describe("notion plugin", () => {
	let tempDir: string;
	let pluginDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-notion-plugin-"));
		pluginDir = path.join(tempDir, "toby-home", "plugins");
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		resetPluginModuleCache();
		copyNotionPlugin(pluginDir);
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

	it("is not a built-in integration", () => {
		expect(isBuiltinIntegration("notion")).toBe(false);
	});

	it("returns notion identity, documents category, resources, and readiness", () => {
		const target = resolvePluginTarget(findNotionPlugin());
		const status = pluginStatus(target, {
			config: { apiKey: "secret-test-token" },
		});
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.name).toBe("notion");
		expect(status.data.displayName).toBe("Notion");
		expect(status.data.capabilities).toContain("chat");
		expect(status.data.providerCategories).toEqual(["documents"]);
		expect(status.data.resources).toEqual(["pages", "databases", "blocks"]);
		expect(status.data.connected).toBe(true);
		expect(status.data.chatReadiness?.ok).toBe(true);
		expect(status.data.chatModelPrep?.systemPromptSection).toContain("Notion");

		const disconnected = pluginStatus(target, {});
		expect(disconnected.ok).toBe(true);
		if (!disconnected.ok) return;
		expect(disconnected.data.connected).toBe(false);
		expect(disconnected.data.chatReadiness?.ok).toBe(false);
		expect(disconnected.data.chatReadiness?.hint).toContain("toby configure");
	});

	it("config shape exposes api key and default parent page id fields", () => {
		const target = resolvePluginTarget(findNotionPlugin());
		const shape = pluginConfigShape(target);
		expect(shape.ok).toBe(true);
		if (!shape.ok) return;
		const apiKey = shape.data.fields?.find((field) => field.key === "apiKey");
		const defaultParent = shape.data.fields?.find(
			(field) => field.key === "defaultParentPageId",
		);
		expect(apiKey?.masked).toBe(true);
		expect(apiKey?.required).toBe(true);
		expect(defaultParent?.required).toBe(false);
	});

	it("maps config fields to namespaced credential descriptors", () => {
		const notion = getIntegrationModule("notion");
		const descriptors = notion?.getCredentialDescriptors() ?? [];
		const apiKey = descriptors.find((d) => d.key === "notion.apiKey");
		const defaultParent = descriptors.find(
			(d) => d.key === "notion.defaultParentPageId",
		);
		expect(apiKey?.masked).toBe(true);
		expect(defaultParent?.label).toBe("Default Parent Page ID");
	});

	it("treats configured token as connected without connectedAt state", async () => {
		writeConfig({ integrations: { notion: {} } });
		writeCredentials({
			integrations: {
				notion: {
					apiKey: "secret-test-token",
					defaultParentPageId: "parent-page-id",
				},
			},
		});

		resetPluginModuleCache();
		const notion = getIntegrationModule("notion");
		expect(notion).toBeDefined();
		expect(await notion?.isConnected()).toBe(true);
		expect(readCredentials().integrations?.notion?.apiKey).toBe(
			"secret-test-token",
		);
	});

	it("lists the five v1 Notion tools with read-only flags", () => {
		const target = resolvePluginTarget(findNotionPlugin());
		const list = pluginToolsList(target);
		expect(list.ok).toBe(true);
		if (!list.ok || !list.data.tools) return;
		const tools = new Map(list.data.tools.map((tool) => [tool.name, tool]));
		expect([...tools.keys()].sort()).toEqual([
			"appendNotionPageContent",
			"createNotionPage",
			"getNotionPage",
			"listNotionBlockChildren",
			"searchNotion",
		]);
		expect(tools.get("searchNotion")?.readOnly).toBe(true);
		expect(tools.get("getNotionPage")?.readOnly).toBe(true);
		expect(tools.get("listNotionBlockChildren")?.readOnly).toBe(true);
		expect(tools.get("createNotionPage")?.readOnly).toBe(false);
		expect(tools.get("appendNotionPageContent")?.readOnly).toBe(false);
	});

	it("registers plugin-backed notion module", () => {
		const found = findNotionPlugin();
		const metadata = loadPluginMetadata(found);
		expect("error" in metadata).toBe(false);
		if ("error" in metadata) return;

		const module = createPluginIntegrationModule(metadata);
		expect(module.name).toBe("notion");
		expect(module.providerCategories).toEqual(["documents"]);
		expect(module.chatModelPrep?.systemPromptSection).toContain("Notion");
	});

	it("executes dry-run tools and validates required input without network", () => {
		const target = resolvePluginTarget(findNotionPlugin());
		const search = pluginToolsExecute(target, {
			tool: "searchNotion",
			input: { query: "launch plan", limit: 2 },
			dryRun: true,
		});
		expect(search.ok).toBe(true);
		if (!search.ok) return;
		expect(search.data.ok).toBe(true);
		expect(search.data.result).toMatchObject({
			dryRun: true,
			query: "launch plan",
			limit: 2,
		});

		const create = pluginToolsExecute(target, {
			tool: "createNotionPage",
			input: { title: "Launch Plan", markdown: "# Launch\n\n- One" },
			config: { defaultParentPageId: "parent-page-id" },
			dryRun: true,
		});
		expect(create.ok).toBe(true);
		if (!create.ok) return;
		expect(create.data.ok).toBe(true);
		expect(create.data.result).toMatchObject({
			dryRun: true,
			title: "Launch Plan",
			parentPageId: "parent-page-id",
			blockCount: 2,
		});

		const invalid = pluginToolsExecute(target, {
			tool: "createNotionPage",
			input: { title: "Missing parent", markdown: "Body" },
			dryRun: true,
		});
		expect(invalid.ok).toBe(true);
		if (!invalid.ok) return;
		expect(invalid.data.ok).toBe(false);
		expect(invalid.data.error).toContain("parentPageId");
	});

	it("converts basic markdown into Notion block objects", () => {
		const blocks = markdownToBlocks("# Title\n\n- First\n1. Second\n\nBody");
		expect(blocks.map((block) => block.type)).toEqual([
			"heading_1",
			"bulleted_list_item",
			"numbered_list_item",
			"paragraph",
		]);
	});
});
