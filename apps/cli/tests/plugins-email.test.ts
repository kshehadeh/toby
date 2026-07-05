import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	pluginConfigShape,
	pluginStatus,
	pluginToolsList,
} from "@toby/core/integrations/plugins/client";
import { discoverPollablePlugins } from "@toby/core/integrations/plugins/poller";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";

const repoRoot = path.resolve(import.meta.dirname, "..");
const emailEntry = path.join(repoRoot, "../plugin-email/src/index.ts");
const emailPluginSource = path.join(repoRoot, "../plugin-email");

function writeEmailPluginWrapper(pluginDir: string): string {
	fs.mkdirSync(pluginDir, { recursive: true });
	const wrapperPath = path.join(pluginDir, "toby-plugin-email");
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(emailEntry)} "$@"\n`;
	fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
	return wrapperPath;
}

function copyEmailPluginDirectory(pluginDir: string): string {
	fs.mkdirSync(pluginDir, { recursive: true });
	const dest = path.join(pluginDir, "toby-plugin-email");
	fs.cpSync(emailPluginSource, dest, {
		recursive: true,
		filter: (src) =>
			!src.includes(".turbo") &&
			!src.includes(".build") &&
			!src.includes("node_modules"),
	});
	return dest;
}

describe("email plugin", () => {
	let tempDir: string;
	let pluginDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-email-plugin-"));
		pluginDir = path.join(tempDir, "toby-home", "plugins");
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		resetPluginModuleCache();
		writeEmailPluginWrapper(pluginDir);
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

	it("returns email identity and chatModelPrep from status", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-email");
		const status = pluginStatus(binaryPath, {
			config: {
				imapHost: "imap.example.com",
				imapUsername: "user@example.com",
				imapPassword: "pass",
			},
		});
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.name).toBe("email");
		expect(status.data.displayName).toContain("Email");
		expect(status.data.providerCategories).toEqual(["email"]);
		expect(status.data.chatModelPrep?.systemPromptSection).toContain("Email");
		expect(status.data.chatReadiness?.hint).toContain("toby connect email");
	});

	it("maps IMAP and SMTP fields in config shape", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-email");
		const shape = pluginConfigShape(binaryPath);
		expect(shape.ok).toBe(true);
		if (!shape.ok || !shape.data.fields) return;

		const keys = shape.data.fields.map((f) => f.key);
		expect(keys).toContain("imapHost");
		expect(keys).toContain("imapPort");
		expect(keys).toContain("imapSecure");
		expect(keys).toContain("imapUsername");
		expect(keys).toContain("imapPassword");
		expect(keys).toContain("smtpHost");
		expect(keys).toContain("smtpPort");
		expect(keys).toContain("smtpSecure");
		expect(keys).toContain("smtpUsername");
		expect(keys).toContain("smtpPassword");
		expect(keys).toContain("fromAddress");
		expect(keys).toContain("fromName");

		const passwordField = shape.data.fields.find(
			(f) => f.key === "imapPassword",
		);
		expect(passwordField?.masked).toBe(true);
		const smtpPasswordField = shape.data.fields.find(
			(f) => f.key === "smtpPassword",
		);
		expect(smtpPasswordField?.masked).toBe(true);

		// Boolean fields should use "select" type (configure UI doesn't support "boolean")
		const imapSecureField = shape.data.fields.find(
			(f) => f.key === "imapSecure",
		);
		expect(imapSecureField?.type).toBe("select");
		expect(imapSecureField?.options).toEqual(["true", "false"]);
		expect(imapSecureField?.default).toBe("true");

		const smtpSecureField = shape.data.fields.find(
			(f) => f.key === "smtpSecure",
		);
		expect(smtpSecureField?.type).toBe("select");
		expect(smtpSecureField?.options).toEqual(["true", "false"]);
		expect(smtpSecureField?.default).toBe("false");

		// Port fields should use "string" type (configure UI doesn't support "number")
		const imapPortField = shape.data.fields.find((f) => f.key === "imapPort");
		expect(imapPortField?.type).toBe("string");
		expect(imapPortField?.default).toBe("993");

		const smtpPortField = shape.data.fields.find((f) => f.key === "smtpPort");
		expect(smtpPortField?.type).toBe("string");
		expect(smtpPortField?.default).toBe("587");
	});

	it("lists all email chat tools", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-email");
		const list = pluginToolsList(binaryPath);
		expect(list.ok).toBe(true);
		if (!list.ok || !list.data.tools) return;
		const toolNames = list.data.tools.map((t) => t.name);
		expect(toolNames).toContain("getInboxOverview");
		expect(toolNames).toContain("getEmailMetadata");
		expect(toolNames).toContain("getEmailBody");
		expect(toolNames).toContain("searchEmails");
		expect(toolNames).toContain("syncMailbox");
		expect(toolNames).toContain("createDraft");
		expect(toolNames).toContain("updateDraft");
		expect(toolNames).toContain("listDrafts");
		expect(toolNames).toContain("deleteDraft");
		expect(toolNames).toContain("sendEmail");
		expect(toolNames).toContain("sendDraft");
		expect(toolNames).toContain("getUnreadSummary");
	});

	it("tags getUnreadSummary with email.unreadSummary standardTool", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-email");
		const list = pluginToolsList(binaryPath);
		expect(list.ok).toBe(true);
		if (!list.ok || !list.data.tools) return;
		const unreadTool = list.data.tools.find(
			(t) => t.name === "getUnreadSummary",
		);
		expect(unreadTool).toBeDefined();
		expect(unreadTool?.standardTool).toBe("email.unreadSummary");
		expect(unreadTool?.readOnly).toBe(true);
	});

	it("status reports not connected when no credentials", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-email");
		const status = pluginStatus(binaryPath, { config: {} });
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.connected).toBe(false);
	});

	it("status reports connected when IMAP credentials present", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-email");
		const status = pluginStatus(binaryPath, {
			config: {
				imapHost: "imap.example.com",
				imapUsername: "user",
				imapPassword: "pass",
			},
			state: { connectedAt: "2025-01-01T00:00:00Z" },
		});
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.connected).toBe(true);
	});
});

describe("email plugin manifest polling", () => {
	let tempDir: string;
	let pluginDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-email-poll-test-"));
		pluginDir = path.join(tempDir, "toby-home", "plugins");
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		resetPluginModuleCache();
		copyEmailPluginDirectory(pluginDir);
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

	it("discovers plugin-email as pollable from manifest events.poll", () => {
		const pollable = discoverPollablePlugins();
		expect(pollable.length).toBeGreaterThan(0);
		const email = pollable.find((p) => p.name === "email");
		expect(email).toBeDefined();
		if (!email) return;
		expect(email.intervalMs).toBe(300_000); // 300 seconds from manifest
		expect(email.dataDir).toBeDefined();
	});

	it("creates plugin data directory when discovered", () => {
		const pollable = discoverPollablePlugins();
		const email = pollable.find((p) => p.name === "email");
		expect(email).toBeDefined();
		if (!email) return;
		expect(fs.existsSync(email.dataDir)).toBe(true);
	});
});
