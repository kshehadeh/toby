import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	inferProviderCategoriesFromPrompt,
	resolveChatModulesForPrompt,
} from "@toby/core/chat-pipeline/resolve-chat-modules";
import type { IntegrationModule } from "@toby/core/integrations/types";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

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
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-resolve-modules-"));
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = tempDir;
	});

	afterEach(() => {
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

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
