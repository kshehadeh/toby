import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	getChatInboundDisabledReason,
	resolveActiveChatInbound,
} from "@toby/core/config/chat-inbound";
import { writeConfig } from "@toby/core/config/index";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const slackCli = path.join(repoRoot, "../plugin-slack/src/cli.ts");

function writeSlackPluginWrapper(pluginDir: string): void {
	fs.mkdirSync(pluginDir, { recursive: true });
	const wrapperPath = path.join(pluginDir, "toby-plugin-slack");
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(slackCli)} "$@"\n`;
	fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
}

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "toby-inbound-cfg-"));
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
	Reflect.deleteProperty(process.env, "TOBY_CHAT_INBOUND_ENABLED");
	Reflect.deleteProperty(process.env, "TOBY_CHAT_INBOUND_INTEGRATION");
});

describe("chat inbound config", () => {
	it("reports missing integration", () => {
		writeConfig({ integrations: {}, personas: [] });
		expect(getChatInboundDisabledReason()).toContain(
			"chatInbound.integration is missing",
		);
		expect(resolveActiveChatInbound()).toBeNull();
	});

	it("allows inbound when global enabled targets integration", () => {
		writeConfig({
			integrations: {
				slack: { connectedAt: "2026-01-01", inboundEnabled: false },
			},
			personas: [],
			chatInbound: { enabled: true, integration: "slack" },
		});
		expect(getChatInboundDisabledReason()).toBeNull();
		expect(resolveActiveChatInbound()?.module.name).toBe("slack");
	});

	it("reports when global inbound disabled", () => {
		writeConfig({
			integrations: {
				slack: { connectedAt: "2026-01-01", inboundEnabled: false },
			},
			personas: [],
			chatInbound: { enabled: false, integration: "slack" },
		});
		expect(getChatInboundDisabledReason()).toContain(
			"chatInbound.enabled is false",
		);
	});

	it("resolves when fully configured", () => {
		writeConfig({
			integrations: {
				slack: { connectedAt: "2026-01-01", inboundEnabled: true },
			},
			personas: [],
			chatInbound: { enabled: true, integration: "slack" },
		});
		expect(getChatInboundDisabledReason()).toBeNull();
		const active = resolveActiveChatInbound();
		expect(active?.module.name).toBe("slack");
	});
});
