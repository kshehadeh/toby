import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	getChatInboundDisabledReason,
	resolveActiveChatInbound,
} from "../src/config/chat-inbound";
import { writeConfig } from "../src/config/index";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "toby-inbound-cfg-"));
}

afterEach(() => {
	const dir = process.env.TOBY_DIR;
	if (dir && fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	delete process.env.TOBY_DIR;
	delete process.env.TOBY_CHAT_INBOUND_ENABLED;
	delete process.env.TOBY_CHAT_INBOUND_INTEGRATION;
});

describe("chat inbound config", () => {
	it("reports missing integration", () => {
		process.env.TOBY_DIR = makeTempDir();
		writeConfig({ integrations: {}, personas: [] });
		expect(getChatInboundDisabledReason()).toContain(
			"chatInbound.integration is missing",
		);
		expect(resolveActiveChatInbound()).toBeNull();
	});

	it("allows inbound when global enabled targets integration", () => {
		process.env.TOBY_DIR = makeTempDir();
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
		process.env.TOBY_DIR = makeTempDir();
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
		process.env.TOBY_DIR = makeTempDir();
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
