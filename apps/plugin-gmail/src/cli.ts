#!/usr/bin/env bun
/**
 * Gmail installable Toby plugin (protocol v1).
 * Build: bun run build (from this directory) or `bun run build:plugin:gmail` from repo root.
 */

import { GMAIL_REDIRECT_URI, GMAIL_SCOPES } from "./auth";
import {
	consumeTokenRefreshPatch,
	fetchUnreadInbox,
	getGmailGrantedScopes,
	hasGmailCredentials,
	hasGmailOAuthTokens,
	listInboxUnreadPage,
	normalizeConfig,
	runOAuthConnect,
	testGmailConnection,
} from "./client";
import {
	GMAIL_MULTI_USER_CONTENT_TEMPLATE,
	GMAIL_SINGLE_SESSION_RULES,
	GMAIL_SINGLE_SESSION_USER_TEMPLATE,
	GMAIL_SYSTEM_PROMPT_SECTION,
} from "./prompts";
import { emitError, emitJson, parseEnvelope, readStdin } from "./protocol";
import { TOOL_DEFINITIONS, executeTool } from "./tools";

type JsonRecord = Record<string, unknown>;

const PLUGIN_VERSION = "1.0.0";
const PROTOCOL_VERSION = "1";
const DISPLAY_NAME = "Gmail";
const DESCRIPTION = "Connect to your Gmail account to read and organize email";

function isConnected(config: JsonRecord, state: JsonRecord): boolean {
	return Boolean(state.connectedAt) || hasGmailOAuthTokens(config);
}

function buildChatModelPrep() {
	return {
		systemPromptSection: GMAIL_SYSTEM_PROMPT_SECTION,
		singleSessionRules: GMAIL_SINGLE_SESSION_RULES,
		singleSessionUserTemplate: GMAIL_SINGLE_SESSION_USER_TEMPLATE,
		multiUserContentTemplate: GMAIL_MULTI_USER_CONTENT_TEMPLATE,
	};
}

function buildChatReadiness(
	config: JsonRecord,
	state: JsonRecord,
): { ok: boolean; hint?: string } {
	if (state.connectedAt) {
		return { ok: true };
	}
	if (hasGmailCredentials(config)) {
		return {
			ok: false,
			hint: "Run `toby connect gmail` to authenticate.",
		};
	}
	return {
		ok: false,
		hint: "Add Gmail clientId/clientSecret in `toby configure`, then run `toby connect gmail`.",
	};
}

async function validateGmailTools(
	config: JsonRecord,
): Promise<Array<{ tool: string; ok: boolean; details: string }>> {
	const checks: Array<{ tool: string; ok: boolean; details: string }> = [];

	try {
		await fetchUnreadInbox(config, 1);
		checks.push({
			tool: "getRecentEmails",
			ok: true,
			details: "Fetched inbox metadata successfully.",
		});
	} catch (error) {
		checks.push({
			tool: "getRecentEmails",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	try {
		await listInboxUnreadPage(config, 1);
		checks.push({
			tool: "getInboxUnreadOverview",
			ok: true,
			details: "Listed inbox unread page successfully.",
		});
	} catch (error) {
		checks.push({
			tool: "getInboxUnreadOverview",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	try {
		const scopes = await getGmailGrantedScopes(config);
		const hasModifyScope = scopes.includes(
			"https://www.googleapis.com/auth/gmail.modify",
		);

		checks.push({
			tool: "listLabels",
			ok: true,
			details: "Authenticated and token scopes resolved.",
		});
		for (const tool of [
			"createAndApplyLabel",
			"applyMultipleLabels",
			"markAsRead",
			"archiveEmail",
			"createDraft",
		]) {
			checks.push({
				tool,
				ok: hasModifyScope,
				details: hasModifyScope
					? "gmail.modify scope is present."
					: "Missing required gmail.modify scope.",
			});
		}
	} catch (error) {
		const message = `Could not validate token scopes: ${toErrorMessage(error)}`;
		for (const tool of [
			"listLabels",
			"createAndApplyLabel",
			"applyMultipleLabels",
			"markAsRead",
			"archiveEmail",
			"createDraft",
		]) {
			checks.push({ tool, ok: false, details: message });
		}
	}

	return checks;
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
	const payload: JsonRecord = {
		ok: true,
		name: "gmail",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		version: PLUGIN_VERSION,
		protocolVersion: PROTOCOL_VERSION,
		connected,
		capabilities: ["chat"],
		providerCategories: ["email"],
		resources: ["inbox", "labels", "messages"],
		chatModelPrep: buildChatModelPrep(),
		chatReadiness: buildChatReadiness(config, state),
		details: connected
			? "Gmail API reachable."
			: "Gmail is not connected. Run `toby connect gmail` after configuring credentials.",
	};

	if (state.connectedAt) {
		try {
			await testGmailConnection(config);
			payload.details = "Gmail API reachable.";
		} catch (error) {
			payload.ok = false;
			payload.details = `Connected, but Gmail API check failed: ${toErrorMessage(error)}`;
		}
	}

	if (validateTools && state.connectedAt) {
		const toolChecks = await validateGmailTools(config);
		payload.tools = toolChecks;
		const failedChecks = toolChecks.filter((c) => !c.ok);
		if (failedChecks.length === 0) {
			payload.details = `Successfully authenticated and validated ${toolChecks.length}/${toolChecks.length} tools.`;
		} else {
			payload.ok = failedChecks.length === 0;
			payload.details = `Connected, but ${failedChecks.length}/${toolChecks.length} tool checks failed.`;
		}
	}

	emitJson(payload);
}

async function handleConnect(config: JsonRecord): Promise<never> {
	if (!hasGmailCredentials(config)) {
		emitJson({
			ok: false,
			reason:
				"Gmail requires clientId and clientSecret. Set them in `toby configure`.",
		});
	}

	try {
		const configPatch = await runOAuthConnect(config);
		const mergedConfig = { ...config, ...configPatch };
		await testGmailConnection(mergedConfig);
		emitJson({
			ok: true,
			reason: "Gmail connected successfully.",
			config: {
				...normalizeConfig(mergedConfig),
				...configPatch,
			},
		});
	} catch (error) {
		emitJson({ ok: false, reason: toErrorMessage(error) });
	}
}

function handleDisconnect(config: JsonRecord): never {
	emitJson({
		ok: true,
		reason: "Gmail disconnected.",
		config: {
			...normalizeConfig(config),
			oauthAccessToken: "",
			oauthRefreshToken: "",
			oauthExpiresAt: "",
		},
	});
}

function handleConfigShape(): never {
	emitJson({
		ok: true,
		fields: [
			{
				key: "clientId",
				label: "Client ID",
				type: "string",
				required: true,
			},
			{
				key: "clientSecret",
				label: "Client Secret",
				type: "string",
				required: true,
				masked: true,
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
	emitJson({ ok: true, reason: "Gmail config synced." });
}

function handleToolsList(): never {
	emitJson({
		ok: true,
		tools: TOOL_DEFINITIONS,
	});
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

	if (!TOOL_DEFINITIONS.some((t) => t.name === tool)) {
		emitJson({ ok: false, error: `Unknown tool: ${tool}` });
	}

	try {
		const {
			result,
			appliedActions,
			config: configPatch,
		} = await executeTool(tool, input, config, dryRun);
		const response: JsonRecord = { ok: true, result };
		const tokenPatch = configPatch ?? consumeTokenRefreshPatch();
		if (tokenPatch) {
			response.config = tokenPatch;
		}
		if (appliedActions?.length) {
			response.appliedActions = appliedActions;
		}
		emitJson(response);
	} catch (error) {
		emitJson({ ok: false, error: toErrorMessage(error) });
	}
}

function handleSetupGuide(): never {
	emitJson({
		ok: true,
		name: "gmail",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		steps: [
			{
				id: "overview",
				title: "What Gmail can do in Toby",
				description:
					"Connect Toby to your Gmail account so you can read unread messages, apply labels, mark messages as read, archive emails, and create drafts from chat.",
			},
			{
				id: "provider",
				title: "Set up Google Cloud OAuth",
				description:
					"Open Google Cloud Console, create or select a project, enable the Gmail API, and create an OAuth 2.0 Desktop app credential. On the OAuth consent screen, add the Gmail scopes listed below. When prompted, paste the redirect URI.",
				links: [
					{
						label: "Google Cloud Console",
						url: "https://console.cloud.google.com/",
					},
				],
				artifacts: [
					{
						id: "redirectUri",
						label: "Authorized redirect URI",
						value: GMAIL_REDIRECT_URI,
						hint: "Add this to the OAuth credential's Authorized redirect URIs.",
					},
					{
						id: "scopes",
						label: "Gmail scopes",
						value: GMAIL_SCOPES.join("\n"),
						hint: "Add these on the OAuth consent screen under Scopes.",
					},
				],
			},
			{
				id: "credentials",
				title: "Add OAuth credentials",
				description:
					"Copy the Client ID and Client Secret from Google Cloud Console into the fields below. Keep them secret.",
			},
			{
				id: "auth",
				title: "Authorize Toby",
				description:
					"Click Connect. Toby will open your browser to sign in with Google and return an access token automatically.",
			},
			{
				id: "validate",
				title: "Validate",
				description:
					"Toby will run a health check to confirm Gmail is reachable and token scopes are sufficient for reading and modifying messages.",
			},
		],
	});
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

	if (command === "setup" && subcommand === "guide") {
		handleSetupGuide();
	}

	emitError(`Unknown command: ${command ?? "(none)"}`, "usage", 2);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	emitError(message, "internal_error", 2);
});
