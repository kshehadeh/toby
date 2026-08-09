import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	getChatInboundStatus,
	resetChatInboundStatus,
	setChatInboundStatus,
} from "@toby/core/chat-inbound/status";
import {
	requestChatInboundReload,
	syncChatInboundStatusFromConfig,
} from "@toby/core/chat-inbound/supervisor";
import { writeConfig } from "@toby/core/config/index";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import { patchAffectsChatInbound } from "@toby/core/web/handlers/configure";
import { handleDaemonStatus } from "@toby/core/web/handlers/daemon";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "toby-inbound-status-"));
}

let tempDir: string;
let previousTobyDir: string | undefined;

beforeEach(() => {
	tempDir = makeTempDir();
	previousTobyDir = process.env.TOBY_DIR;
	process.env.TOBY_DIR = path.join(tempDir, "toby-home");
	fs.mkdirSync(process.env.TOBY_DIR, { recursive: true });
	resetPluginModuleCache();
	resetChatInboundStatus();
});

afterEach(() => {
	if (previousTobyDir === undefined) {
		Reflect.deleteProperty(process.env, "TOBY_DIR");
	} else {
		process.env.TOBY_DIR = previousTobyDir;
	}
	resetPluginModuleCache();
	resetChatInboundStatus();
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("daemon status chatInbound effective state", () => {
	it("reports disabled when config is off even if runtime still says connected", async () => {
		writeConfig({
			integrations: {
				slack: { connectedAt: "2026-01-01", inboundEnabled: true },
			},
			personas: [],
			chatInbound: { enabled: false, integration: "slack" },
		});
		// Stale runtime from before the user disabled inbound in settings.
		setChatInboundStatus({
			integration: "slack",
			status: "connected",
			detail: null,
			activeConversationName: "Slack #general",
			activeSince: "2026-01-01T00:00:00Z",
			activeKind: "turn",
		});

		const res = handleDaemonStatus();
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			chatInbound: {
				enabled: boolean;
				status: string;
				disabledReason: string | null;
				detail: string | null;
				activeConversationName: string | null;
			};
		};
		expect(body.chatInbound.enabled).toBe(false);
		expect(body.chatInbound.status).toBe("disabled");
		expect(body.chatInbound.disabledReason).toContain(
			"chatInbound.enabled is false",
		);
		expect(body.chatInbound.detail).toBeNull();
		expect(body.chatInbound.activeConversationName).toBeNull();
	});

	it("syncChatInboundStatusFromConfig clears connected runtime when disabled", () => {
		writeConfig({
			integrations: {},
			personas: [],
			chatInbound: { enabled: false, integration: "slack" },
		});
		setChatInboundStatus({
			integration: "slack",
			status: "connected",
			detail: null,
		});
		syncChatInboundStatusFromConfig();
		const snap = getChatInboundStatus();
		expect(snap.status).toBe("disabled");
		expect(snap.activeKind).toBeNull();
	});

	it("requestChatInboundReload syncs disabled status without supervisor", () => {
		writeConfig({
			integrations: {},
			personas: [],
			chatInbound: { enabled: false },
		});
		setChatInboundStatus({
			integration: "slack",
			status: "connected",
			detail: null,
		});
		requestChatInboundReload();
		expect(getChatInboundStatus().status).toBe("disabled");
	});
});

describe("patchAffectsChatInbound", () => {
	it("detects chatInbound and inbound credential keys", () => {
		expect(patchAffectsChatInbound({ "chatInbound.enabled": "false" })).toBe(
			true,
		);
		expect(patchAffectsChatInbound({ "slack.inboundEnabled": "true" })).toBe(
			true,
		);
		expect(patchAffectsChatInbound({ "slack.botToken": "xoxb-1" })).toBe(true);
		expect(patchAffectsChatInbound({ "ai.provider": "openai" })).toBe(false);
	});
});
