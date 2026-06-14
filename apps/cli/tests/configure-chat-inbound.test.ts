import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	readConfig,
	readCredentials,
	writeCredentials,
} from "@toby/core/config/index";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConfigureSession } from "../src/ui/configure/session";

const repoRoot = path.resolve(import.meta.dirname, "..");
const slackCli = path.join(repoRoot, "../plugin-slack/src/cli.ts");
const todoistCli = path.join(repoRoot, "../plugin-todoist/src/cli.ts");

function writePluginWrapper(
	pluginDir: string,
	binaryName: string,
	cliPath: string,
): void {
	fs.mkdirSync(pluginDir, { recursive: true });
	const wrapperPath = path.join(pluginDir, binaryName);
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(cliPath)} "$@"\n`;
	fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
}

function writeSlackPluginWrapper(pluginDir: string): void {
	writePluginWrapper(pluginDir, "toby-plugin-slack", slackCli);
}

function writeTodoistPluginWrapper(pluginDir: string): void {
	writePluginWrapper(pluginDir, "toby-plugin-todoist", todoistCli);
}

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "toby-configure-"));
}

let tempDir: string;
let previousTobyDir: string | undefined;

beforeEach(() => {
	tempDir = makeTempDir();
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

describe("configure credential save", () => {
	it("persists slack bot token when another plugin merges after slack", () => {
		const pluginDir = path.join(tempDir, "toby-home", "plugins");
		writeTodoistPluginWrapper(pluginDir);
		resetPluginModuleCache();

		writeCredentials({
			integrations: {
				slack: { botToken: "", authMethod: "bot_token" },
				todoist: { apiToken: "existing-todoist-token" },
			},
		});

		const session = createConfigureSession();
		const values = {
			...session.initialValues,
			"slack.authMethod": "bot_token",
			"slack.botToken": "xoxb-new-token",
		};
		session.onSave(values);

		expect(readCredentials().integrations?.slack?.botToken).toBe(
			"xoxb-new-token",
		);
	});
});

describe("configure chat inbound", () => {
	it("persists chatInbound and integration inboundEnabled on save", () => {
		const session = createConfigureSession();
		const values = {
			...session.initialValues,
			"chatInbound.enabled": "true",
			"chatInbound.integration": "slack",
			"chatInbound.persona": "(default)",
			"slack.inboundEnabled": "true",
		};
		session.onSave(values);

		const cfg = readConfig();
		expect(cfg.chatInbound?.enabled).toBe(true);
		expect(cfg.chatInbound?.integration).toBe("slack");
		expect(
			(cfg.integrations.slack as { inboundEnabled?: boolean })?.inboundEnabled,
		).toBe(true);
	});
});
