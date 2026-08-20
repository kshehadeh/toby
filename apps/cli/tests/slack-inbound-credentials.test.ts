import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCredentials, writeCredentials } from "@toby/core/config/index";
import { buildSettingsTree } from "@toby/core/configure/tree";
import { migrateLegacyPluginCredentials } from "@toby/core/integrations/plugins/migrate";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import { closeChatDbForTests } from "@toby/core/session-store";
import { getSlackInboundCredentials } from "../../plugin-slack/src/client";

const repoRoot = path.resolve(import.meta.dirname, "..");
const slackCli = path.join(repoRoot, "../plugin-slack/src/cli.ts");

function writeSlackPluginWrapper(pluginDir: string): void {
	fs.mkdirSync(pluginDir, { recursive: true });
	const wrapperPath = path.join(pluginDir, "toby-plugin-slack");
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(slackCli)} "$@"\n`;
	fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
}

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "toby-slack-inbound-"));
}

function writeCredentialsFile(data: object): void {
	const dir = process.env.TOBY_DIR;
	if (!dir) throw new Error("TOBY_DIR must be set for this test.");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "credentials.json"),
		JSON.stringify(data, null, 2),
	);
}

type SettingsNode = {
	key: string;
	children?: SettingsNode[];
	showForAuthMethods?: string[];
	showForInbound?: boolean;
	selectChoices?: Array<{ value: string; label: string }>;
};

function findSlackField(
	root: SettingsNode,
	key: string,
): SettingsNode | undefined {
	const integrations = root.children?.find((c) => c.key === "integrations");
	const slack = integrations?.children?.find((c) => c.key === "slack");
	return slack?.children?.find((c) => c.key === key);
}

function treeHasKey(root: SettingsNode, key: string): boolean {
	return findSlackField(root, key) !== undefined;
}

describe("Slack inbound credentials", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = makeTempDir();
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

	it("mentions user OAuth when bot token missing", () => {
		const config = {
			oauthUserToken: "xoxp-user",
			appToken: "xapp-test",
		};
		expect(() => getSlackInboundCredentials(config)).toThrow(
			/bot token \(xoxb/,
		);
		expect(() => getSlackInboundCredentials(config)).toThrow(
			/user token \(xoxp/,
		);
	});

	it("returns tokens when bot and app are set", () => {
		expect(
			getSlackInboundCredentials({
				botToken: "xoxb-bot",
				appToken: "xapp-socket",
			}),
		).toEqual({
			botToken: "xoxb-bot",
			appToken: "xapp-socket",
			botUserId: undefined,
		});
	});

	it("uses legacy top-level slack.botToken after credential migration", () => {
		writeCredentialsFile({
			slack: {
				botToken: "xoxb-legacy",
				appToken: "xapp-socket",
			},
		});
		migrateLegacyPluginCredentials();
		const migrated = readCredentials().integrations?.slack ?? {};
		expect(getSlackInboundCredentials(migrated)).toEqual({
			botToken: "xoxb-legacy",
			appToken: "xapp-socket",
			botUserId: undefined,
		});
	});
});

describe("configure Slack inbound fields", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = makeTempDir();
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = tempDir;
		resetPluginModuleCache();
		writeSlackPluginWrapper(path.join(tempDir, "plugins"));
	});

	afterEach(() => {
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		resetPluginModuleCache();
		closeChatDbForTests();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("includes bot token with inbound and bot_token gating regardless of current auth", () => {
		const root = buildSettingsTree(
			[],
			[],
			{
				"slack.authMethod": "oauth",
				"chatInbound.enabled": "false",
				"chatInbound.integration": "(none)",
			},
			undefined,
			{ daemonRunning: true },
		);
		const botToken = findSlackField(root, "slack.botToken");
		expect(botToken).toBeDefined();
		expect(botToken?.showForAuthMethods).toEqual(["bot_token"]);
		expect(botToken?.showForInbound).toBe(true);
		expect(treeHasKey(root, "slack.clientId")).toBe(true);
	});

	it("keeps oauth credential fields in the tree when auth is bot_token", () => {
		const root = buildSettingsTree(
			[],
			[],
			{
				"slack.authMethod": "bot_token",
			},
			undefined,
			{ daemonRunning: true },
		);
		const clientId = findSlackField(root, "slack.clientId");
		expect(clientId?.showForAuthMethods).toEqual(["oauth"]);
		expect(findSlackField(root, "slack.botToken")?.showForAuthMethods).toEqual([
			"bot_token",
		]);
		const authSelect = findSlackField(root, "slack.authMethod");
		expect(authSelect?.selectChoices?.map((c) => c.value)).toEqual([
			"oauth",
			"bot_token",
		]);
	});
});
