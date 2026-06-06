import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSlackInboundCredentials } from "@toby/core/integrations/slack/client";
import { afterEach, describe, expect, it } from "vitest";
import { buildSettingsTree } from "../src/ui/configure/items";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "toby-slack-inbound-"));
}

function writeCredentials(data: object): void {
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
};

function itemHasKey(items: SettingsNode[] | undefined, key: string): boolean {
	if (!items) return false;
	for (const item of items) {
		if (item.key === key) return true;
		if (itemHasKey(item.children, key)) return true;
	}
	return false;
}

function treeHasKey(root: SettingsNode, key: string): boolean {
	const integrations = root.children?.find((c) => c.key === "integrations");
	const slack = integrations?.children?.find((c) => c.key === "slack");
	return itemHasKey(slack?.children, key);
}

afterEach(() => {
	const dir = process.env.TOBY_DIR;
	if (dir && fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	Reflect.deleteProperty(process.env, "TOBY_DIR");
});

describe("Slack inbound credentials", () => {
	it("mentions user OAuth when bot token missing", () => {
		process.env.TOBY_DIR = makeTempDir();
		writeCredentials({
			integrations: {
				slack: {
					oauthUserToken: "xoxp-user",
					appToken: "xapp-test",
				},
			},
		});
		expect(() => getSlackInboundCredentials()).toThrow(/bot token \(xoxb/);
		expect(() => getSlackInboundCredentials()).toThrow(/user token \(xoxp/);
	});

	it("returns tokens when bot and app are set", () => {
		process.env.TOBY_DIR = makeTempDir();
		writeCredentials({
			integrations: {
				slack: {
					botToken: "xoxb-bot",
					appToken: "xapp-socket",
				},
			},
		});
		expect(getSlackInboundCredentials()).toEqual({
			botToken: "xoxb-bot",
			appToken: "xapp-socket",
			botUserId: undefined,
		});
	});

	it("uses legacy top-level slack.botToken when integrations entry is empty", () => {
		process.env.TOBY_DIR = makeTempDir();
		writeCredentials({
			integrations: {
				slack: {
					botToken: "",
					appToken: "xapp-socket",
					oauthUserToken: "xoxp-user",
				},
			},
			slack: {
				botToken: "xoxb-legacy",
				appToken: "",
			},
		});
		expect(getSlackInboundCredentials()).toEqual({
			botToken: "xoxb-legacy",
			appToken: "xapp-socket",
			botUserId: undefined,
		});
	});
});

describe("configure Slack inbound fields", () => {
	it("shows bot token for OAuth when global inbound targets slack", () => {
		const root = buildSettingsTree([], [], {
			"slack.authMethod": "oauth",
			"chatInbound.enabled": "true",
			"chatInbound.integration": "slack",
		});
		expect(treeHasKey(root, "slack.botToken")).toBe(true);
	});

	it("hides bot token for OAuth when inbound is off", () => {
		const root = buildSettingsTree([], [], {
			"slack.authMethod": "oauth",
			"chatInbound.enabled": "false",
			"chatInbound.integration": "(none)",
		});
		expect(treeHasKey(root, "slack.botToken")).toBe(false);
	});
});
