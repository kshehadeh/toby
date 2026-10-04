#!/usr/bin/env bun
/**
 * Email (IMAP/SMTP) installable Toby plugin (protocol v1, bun-package).
 * Uses IMAP for reading/managing messages, SMTP for sending, and a local
 * SQLite cache for fast offline access.
 */

import {
	hasCredentials,
	normalizeConfig,
	parseEmailConfig,
	syncMailbox,
	testConnection,
} from "./client";
import { openDb } from "./db";
import { discoverEmailSettings } from "./discover";
import { log } from "./log";
import {
	EMAIL_MULTI_USER_CONTENT_TEMPLATE,
	EMAIL_SINGLE_SESSION_RULES,
	EMAIL_SINGLE_SESSION_USER_TEMPLATE,
	EMAIL_SYSTEM_PROMPT_SECTION,
} from "./prompts";
import {
	type JsonRecord,
	emitError,
	emitJson,
	parseEnvelope,
	readStdin,
} from "./protocol";
import { TOOL_DEFINITIONS, executeTool } from "./tools";

const PLUGIN_VERSION = "1.0.0";
const PROTOCOL_VERSION = "1";
const DISPLAY_NAME = "Email (IMAP/SMTP)";
const DESCRIPTION =
	"Generic email integration using IMAP for reading and SMTP for sending, with a local SQLite cache";

function isConnected(config: JsonRecord, state: JsonRecord): boolean {
	return Boolean(state.connectedAt) || hasCredentials(config);
}

function buildChatReadiness(
	config: JsonRecord,
	state: JsonRecord,
): { ok: boolean; hint?: string } {
	if (state.connectedAt) {
		return { ok: true };
	}
	if (hasCredentials(config)) {
		return {
			ok: false,
			hint: "Run `toby connect email` to verify IMAP connectivity.",
		};
	}
	return {
		ok: false,
		hint: "Add IMAP and SMTP credentials in `toby configure`, then run `toby connect email`.",
	};
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function handleStatus(
	config: JsonRecord,
	state: JsonRecord,
	validateTools: boolean,
): Promise<never> {
	const connected = isConnected(config, state);
	log.debug("status", { connected, hasState: Boolean(state.connectedAt) });
	const payload: JsonRecord = {
		ok: true,
		name: "email",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		version: PLUGIN_VERSION,
		protocolVersion: PROTOCOL_VERSION,
		icon: "📧",
		iconAsset: {
			path: "assets/icon-48.png",
			mimeType: "image/png",
		},
		connected,
		capabilities: ["chat"],
		providerCategories: ["email"],
		resources: ["inbox", "messages", "drafts", "outbox"],
		chatModelPrep: {
			systemPromptSection: EMAIL_SYSTEM_PROMPT_SECTION,
			singleSessionRules: EMAIL_SINGLE_SESSION_RULES,
			singleSessionUserTemplate: EMAIL_SINGLE_SESSION_USER_TEMPLATE,
			multiUserContentTemplate: EMAIL_MULTI_USER_CONTENT_TEMPLATE,
		},
		chatReadiness: buildChatReadiness(config, state),
		details: connected
			? "Email plugin configured."
			: "Email is not connected. Add IMAP/SMTP credentials in `toby configure`.",
	};

	if (connected && state.connectedAt) {
		try {
			await testConnection(config);
			payload.details = "IMAP server reachable.";
			log.debug("status_imap_ok");
		} catch (error) {
			payload.ok = false;
			payload.details = `Connected, but IMAP check failed: ${toErrorMessage(error)}`;
			log.warn("status_imap_failed", { error: toErrorMessage(error) });
		}
	}

	if (validateTools) {
		payload.tools = TOOL_DEFINITIONS.map((def) => ({
			tool: def.name,
			ok: true,
			details: "Tool is available.",
		}));
	}

	emitJson(payload);
}

async function handleConnect(config: JsonRecord): Promise<never> {
	if (!hasCredentials(config)) {
		log.warn("connect_missing_credentials");
		emitJson({
			ok: false,
			reason:
				"Email requires IMAP credentials (host, port, username, password). Add them in `toby configure`.",
		});
	}

	const parsed = parseEmailConfig(config);
	log.info("connect_attempt", { host: parsed.imapHost, port: parsed.imapPort });
	try {
		await testConnection(config);
		log.info("connect_success", { host: parsed.imapHost });
		emitJson({ ok: true, reason: "IMAP connection verified successfully." });
	} catch (error) {
		log.error("connect_failed", {
			host: parsed.imapHost,
			error: toErrorMessage(error),
		});
		emitJson({
			ok: false,
			reason: `IMAP connection failed: ${toErrorMessage(error)}`,
		});
	}
}

function handleDisconnect(config: JsonRecord): never {
	log.info("disconnect");
	emitJson({
		ok: true,
		reason: "Email plugin disconnected.",
		config: normalizeConfig(config),
	});
}

function handleConfigShape(): never {
	emitJson({
		ok: true,
		fields: [
			{
				key: "imapHost",
				label: "Server",
				type: "string",
				required: true,
				placeholder: "imap.gmail.com",
				description: "Your provider's IMAP server.",
				group: "Incoming mail (IMAP)",
			},
			{
				key: "imapPort",
				label: "Port",
				type: "string",
				required: false,
				default: "993",
				placeholder: "993",
				description: "993 for TLS, 143 without.",
				group: "Incoming mail (IMAP)",
			},
			{
				key: "imapSecure",
				label: "Use TLS",
				type: "select",
				options: ["true", "false"],
				required: false,
				default: "true",
				description: "Recommended. Matches port 993.",
				group: "Incoming mail (IMAP)",
			},
			{
				key: "imapUsername",
				label: "Username",
				type: "string",
				required: true,
				placeholder: "you@example.com",
				description: "Usually your full email address.",
				group: "Incoming mail (IMAP)",
			},
			{
				key: "imapPassword",
				label: "Password",
				type: "string",
				required: true,
				masked: true,
				description:
					"Your password, or an app password if your provider requires one.",
				group: "Incoming mail (IMAP)",
			},
			{
				key: "smtpHost",
				label: "Server",
				type: "string",
				required: false,
				placeholder: "smtp.gmail.com",
				description: "Your provider's SMTP server. Needed to send mail.",
				group: "Outgoing mail (SMTP)",
			},
			{
				key: "smtpPort",
				label: "Port",
				type: "string",
				required: false,
				default: "587",
				placeholder: "587",
				description: "587 for STARTTLS, 465 for TLS.",
				group: "Outgoing mail (SMTP)",
			},
			{
				key: "smtpSecure",
				label: "Use TLS",
				type: "select",
				options: ["true", "false"],
				required: false,
				default: "false",
				description: "Turn on for port 465. Leave off for STARTTLS on 587.",
				group: "Outgoing mail (SMTP)",
			},
			{
				key: "smtpUsername",
				label: "Username",
				type: "string",
				required: false,
				placeholder: "you@example.com",
				description: "Usually your full email address.",
				group: "Outgoing mail (SMTP)",
			},
			{
				key: "smtpPassword",
				label: "Password",
				type: "string",
				required: false,
				masked: true,
				description: "Often the same as your incoming mail password.",
				group: "Outgoing mail (SMTP)",
			},
			{
				key: "fromAddress",
				label: "Email address",
				type: "string",
				required: false,
				placeholder: "you@example.com",
				description: "The address messages are sent from.",
				group: "Sender",
			},
			{
				key: "fromName",
				label: "Name",
				type: "string",
				required: false,
				placeholder: "Your name",
				description: "The name people see on messages you send.",
				group: "Sender",
			},
		],
	});
}

function handleConfigGet(config: JsonRecord): never {
	emitJson({
		ok: true,
		config: normalizeConfig(config),
	});
}

function handleConfigSet(): never {
	emitJson({ ok: true, reason: "Email config synced." });
}

function handleToolsList(): never {
	emitJson({ ok: true, tools: TOOL_DEFINITIONS });
}

async function handleToolsExecute(body: JsonRecord): Promise<never> {
	const tool = String(body.tool ?? "");
	const input =
		body.input && typeof body.input === "object" && !Array.isArray(body.input)
			? (body.input as JsonRecord)
			: {};
	const config =
		body.config &&
		typeof body.config === "object" &&
		!Array.isArray(body.config)
			? (body.config as JsonRecord)
			: {};
	const dryRun = Boolean(body.dryRun);
	const dataDir =
		body.paths && typeof body.paths === "object" && !Array.isArray(body.paths)
			? String((body.paths as JsonRecord).dataDir ?? "") || undefined
			: undefined;

	if (!TOOL_DEFINITIONS.some((def) => def.name === tool)) {
		log.warn("tool_unknown", { tool });
		emitJson({ ok: false, error: `Unknown tool: ${tool}` });
	}

	log.debug("tool_execute", { tool, dryRun });
	try {
		const { result, appliedActions } = await executeTool(
			tool,
			input,
			config,
			dryRun,
			dataDir,
		);
		log.debug("tool_execute_done", {
			tool,
			appliedActions: appliedActions?.length ?? 0,
		});
		const response: JsonRecord = { ok: true, result };
		if (appliedActions?.length) {
			response.appliedActions = appliedActions;
		}
		emitJson(response);
	} catch (error) {
		log.error("tool_execute_failed", { tool, error: toErrorMessage(error) });
		emitJson({ ok: false, error: toErrorMessage(error) });
	}
}

/**
 * Handle the `events poll` subcommand.
 * Syncs the INBOX mailbox from IMAP into the local SQLite cache.
 */
async function handleEventsPoll(
	config: JsonRecord,
	state: JsonRecord,
	dataDir: string | undefined,
): Promise<never> {
	if (!hasCredentials(config)) {
		log.debug("poll_skipped_no_credentials");
		emitJson({
			ok: true,
			summary: "Not configured, skipping poll.",
			newCount: 0,
		});
	}

	log.info("poll_start", { dataDir: dataDir ? "yes" : "no" });
	const db = openDb(dataDir);
	try {
		const mailbox = "INBOX";
		const result = await syncMailbox(config, mailbox, db);
		log.info("poll_complete", {
			mailbox,
			newCount: result.newCount,
			lastUid: result.lastUid,
		});
		emitJson({
			ok: true,
			summary: `Synced ${mailbox}: ${result.newCount} new message(s)`,
			newCount: result.newCount,
			details: {
				mailbox: result.mailbox,
				lastUid: result.lastUid,
			},
		});
	} catch (error) {
		log.error("poll_failed", { error: toErrorMessage(error) });
		emitJson({
			ok: false,
			error: toErrorMessage(error),
			code: "poll_failed",
		});
	} finally {
		db.close();
	}
}

async function main(): Promise<void> {
	const [command, subcommand] = process.argv.slice(2);
	const stdin = await readStdin();

	if (command === "status") {
		const { config, state, validateTools } = parseEnvelope(stdin);
		await handleStatus(config, state, validateTools);
	}

	if (command === "connect") {
		const { config } = parseEnvelope(stdin);
		await handleConnect(config);
	}

	if (command === "disconnect") {
		const { config } = parseEnvelope(stdin);
		handleDisconnect(config);
	}

	if (command === "config" && subcommand === "shape") {
		handleConfigShape();
	}

	if (command === "config" && subcommand === "get") {
		const { config } = parseEnvelope(stdin);
		handleConfigGet(config);
	}

	if (command === "config" && subcommand === "set") {
		handleConfigSet();
	}

	if (command === "tools" && subcommand === "list") {
		handleToolsList();
	}

	if (command === "tools" && subcommand === "execute") {
		if (!stdin.trim()) {
			emitError("tools execute requires JSON on stdin", "invalid_input", 2);
		}
		let body: JsonRecord;
		try {
			body = JSON.parse(stdin) as JsonRecord;
		} catch {
			emitError("Invalid JSON on stdin", "invalid_input", 2);
		}
		await handleToolsExecute(body);
	}

	if (command === "events" && subcommand === "poll") {
		const { config, state, dataDir } = parseEnvelope(stdin);
		await handleEventsPoll(config, state, dataDir);
	}

	if (command === "discover") {
		if (!stdin.trim()) {
			emitError("discover requires JSON on stdin", "invalid_input", 2);
		}
		let body: JsonRecord;
		try {
			body = JSON.parse(stdin) as JsonRecord;
		} catch {
			emitError("Invalid JSON on stdin", "invalid_input", 2);
		}
		const result = await discoverEmailSettings(String(body.email ?? ""));
		if (!result.ok) {
			emitError(result.error, result.code, 2);
		}
		emitJson(result as unknown as JsonRecord);
	}

	if (command === "setup" && subcommand === "guide") {
		emitJson({
			ok: true,
			name: "email",
			displayName: DISPLAY_NAME,
			description: DESCRIPTION,
			steps: [
				{
					id: "overview",
					title: "What Email (IMAP/SMTP) can do in Toby",
					description:
						"Connect Toby to any email server using IMAP for reading and managing messages, and SMTP for sending. Messages are cached locally in SQLite for fast offline access.",
				},
				{
					id: "credentials",
					title: "Add IMAP and SMTP credentials",
					description:
						"Enter your IMAP host, port, username, and password. Optionally add SMTP credentials for sending. Many providers require an app-specific password instead of your regular password.",
					links: [
						{
							label: "Gmail",
							url: "https://support.google.com/mail/answer/78892?hl=en&sjid=15691795537353814651-NA",
						},
						{
							label: "Outlook",
							url: "https://support.microsoft.com/en-us/outlook/pop-imap-and-smtp-settings-for-outlook-com",
						},
						{
							label: "Yahoo",
							url: "https://help.yahoo.com/kb/SLN4075.html",
						},
						{
							label: "iCloud",
							url: "https://support.apple.com/en-us/102525",
						},
						{
							label: "ProtonMail",
							url: "https://proton.me/support/imap-smtp-and-pop3-setup",
						},
						{
							label: "Fastmail",
							url: "https://www.fastmail.help/hc/en-us/articles/1500000279921-IMAP-POP-and-SMTP",
						},
					],
				},
				{
					id: "validate",
					title: "Validate",
					description: "Click Connect to verify IMAP connectivity.",
				},
			],
		});
	}

	emitError(`Unknown command: ${command ?? "(none)"}`, "usage", 2);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	emitError(message, "internal_error", 2);
});
