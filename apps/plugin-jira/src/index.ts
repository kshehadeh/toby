#!/usr/bin/env bun
/**
 * Jira installable Toby plugin (protocol v1, bun-package).
 */

import { DEFAULT_REDIRECT_URI, OAUTH_SCOPES, runJiraOAuthFlow } from "./auth";
import { hasCredentials, testConnection } from "./client";
import {
	getConfigField,
	getJiraAuthMethod,
	hasJiraOAuthClientCreds,
	hasJiraOAuthToken,
	normalizeConfig,
} from "./config";
import { buildChatModelPrep } from "./prompts";
import { emitError, emitJson, parseEnvelope, readStdin } from "./protocol";
import { consumeTokenRefreshPatch, mergeOAuthTokens } from "./tokens";
import { TOOL_DEFINITIONS, executeTool } from "./tools";

type JsonRecord = Record<string, unknown>;

const PLUGIN_VERSION = "1.1.0";
const PROTOCOL_VERSION = "1";
const DISPLAY_NAME = "Jira";
const DESCRIPTION = "Atlassian Jira issue tracking";

function isConnected(config: JsonRecord, state: JsonRecord): boolean {
	return Boolean(state.connectedAt) || hasCredentials(config);
}

function buildChatReadiness(
	config: JsonRecord,
	state: JsonRecord,
): { ok: boolean; hint?: string } {
	if (state.connectedAt || hasCredentials(config)) {
		return { ok: true };
	}
	const authMethod = getJiraAuthMethod(config);
	if (authMethod === "oauth" && hasJiraOAuthClientCreds(config)) {
		return {
			ok: false,
			hint: "Run `toby connect jira` to complete OAuth.",
		};
	}
	return {
		ok: false,
		hint:
			authMethod === "api_token"
				? "Add Jira credentials (domain, email, API token) in `toby configure` or run `toby connect jira`."
				: "Add Jira OAuth client ID in `toby configure`, then run `toby connect jira`.",
	};
}

function validateJiraTools(): Array<{
	tool: string;
	ok: boolean;
	details: string;
}> {
	return TOOL_DEFINITIONS.map((definition) => ({
		tool: definition.name,
		ok: true,
		details: "Tool is available.",
	}));
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
		name: "jira",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		version: PLUGIN_VERSION,
		protocolVersion: PROTOCOL_VERSION,
		icon: "🎫",
		iconAsset: {
			path: "assets/icon-48.png",
			mimeType: "image/png",
		},
		connected,
		capabilities: ["chat"],
		providerCategories: ["work_tracker"],
		resources: ["issues", "projects"],
		authMethods: [
			{ id: "oauth", label: "OAuth (recommended)", isDefault: true },
			{ id: "api_token", label: "Email + API token" },
		],
		chatModelPrep: buildChatModelPrep(),
		chatReadiness: buildChatReadiness(config, state),
		details: connected
			? "Jira connected."
			: "Jira is not connected. Run `toby connect jira` after configuring credentials.",
	};

	if (state.connectedAt) {
		try {
			await testConnection(config);
			payload.details = "Jira API reachable.";
		} catch (error) {
			payload.ok = false;
			payload.details = `Connected, but Jira API check failed: ${toErrorMessage(error)}`;
		}
	}

	if (validateTools) {
		payload.tools = validateJiraTools();
	}

	emitJson(payload);
}

async function handleConnect(config: JsonRecord): Promise<never> {
	const authMethod = getJiraAuthMethod(config);

	if (authMethod === "oauth") {
		const clientId = String(config.clientId ?? "").trim();
		const clientSecret = String(config.clientSecret ?? "").trim();
		const redirectUri = String(config.redirectUri ?? "").trim() || undefined;

		if (!clientId) {
			emitJson({
				ok: false,
				reason:
					"Jira OAuth requires clientId. Set it in `toby configure` under Jira.",
			});
		}

		if (!clientSecret) {
			emitJson({
				ok: false,
				reason:
					"Jira OAuth requires clientSecret. Set it in `toby configure` under Jira.",
			});
		}

		try {
			const tokens = await runJiraOAuthFlow({
				clientId,
				clientSecret,
				redirectUri,
			});
			const configPatch = mergeOAuthTokens(config, {
				...tokens,
				clientId,
				clientSecret,
				redirectUri: redirectUri ?? "",
			});
			const mergedConfig = { ...config, ...configPatch };
			await testConnection(mergedConfig);
			emitJson({
				ok: true,
				reason: "Jira connected successfully.",
				config: configPatch,
			});
		} catch (error) {
			emitJson({ ok: false, reason: toErrorMessage(error) });
		}
	}

	// API token path
	if (!hasCredentials(config)) {
		emitJson({
			ok: false,
			reason:
				"Jira requires credentials (domain, email, API token). Add them in `toby configure` under Jira.",
		});
	}

	try {
		await testConnection(config);
		emitJson({
			ok: true,
			reason: "Jira connected successfully.",
			config: normalizeConfig(config),
		});
	} catch (error) {
		emitJson({
			ok: false,
			reason: `Jira credentials are invalid or missing permissions: ${toErrorMessage(error)}`,
		});
	}
}

function handleDisconnect(config: JsonRecord): never {
	const normalized = normalizeConfig(config);
	emitJson({
		ok: true,
		reason: "Jira disconnected.",
		config: {
			...normalized,
			oauthAccessToken: "",
			oauthRefreshToken: "",
			oauthExpiresAt: "",
			cloudId: "",
		},
	});
}

function handleConfigShape(): never {
	emitJson({
		ok: true,
		fields: [
			{
				key: "clientId",
				label: "OAuth Client ID",
				type: "string",
				required: false,
				showForAuthMethods: ["oauth"],
				description:
					"Atlassian OAuth 2.0 (3LO) app Client ID from developer.atlassian.com/console",
			},
			{
				key: "clientSecret",
				label: "OAuth Client Secret",
				type: "string",
				required: false,
				masked: true,
				showForAuthMethods: ["oauth"],
				description:
					"Atlassian OAuth 2.0 (3LO) app Secret from developer.atlassian.com/console",
			},
			{
				key: "redirectUri",
				label: "OAuth Redirect URI (optional)",
				type: "string",
				required: false,
				showForAuthMethods: ["oauth"],
				description: "Defaults to http://localhost:9879/callback",
			},
			{
				key: "domain",
				label: "Atlassian Domain",
				type: "string",
				required: false,
				showForAuthMethods: ["api_token"],
				description:
					"Your Atlassian site domain (e.g. 'acme' for acme.atlassian.net)",
			},
			{
				key: "email",
				label: "Email",
				type: "string",
				required: false,
				showForAuthMethods: ["api_token"],
				description: "Atlassian account email",
			},
			{
				key: "apiToken",
				label: "API Token",
				type: "string",
				required: false,
				masked: true,
				showForAuthMethods: ["api_token"],
				description:
					"Atlassian API token (create at https://id.atlassian.com/manage-profile/security/api-tokens)",
			},
		],
	});
}

function handleConfigGet(config: JsonRecord): never {
	const normalized = normalizeConfig(config);
	emitJson({
		ok: true,
		config: {
			...normalized,
			oauthAccessToken: "",
			oauthRefreshToken: "",
		},
	});
}

function handleConfigSet(): never {
	emitJson({ ok: true, reason: "Jira config synced." });
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

	if (!TOOL_DEFINITIONS.some((definition) => definition.name === tool)) {
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
		name: "jira",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		steps: [
			{
				id: "overview",
				title: "What Jira can do in Toby",
				description:
					"Connect Toby to Atlassian Jira to search and read issues, comments, and projects from chat. All operations are read-only.",
			},
			{
				id: "provider",
				title: "Create an Atlassian OAuth app",
				description:
					"Open the Atlassian developer console and create a new OAuth 2.0 integration. Add the Jira API with read scopes, configure the callback URL, then return to Toby.",
				links: [
					{
						label: "Atlassian developer console",
						url: "https://developer.atlassian.com/console/myapps/",
					},
				],
				artifacts: [
					{
						id: "redirectUri",
						label: "Callback URL",
						value: DEFAULT_REDIRECT_URI,
						hint: "Add this to Authorization → OAuth 2.0 (3LO) → Callback URL.",
					},
					{
						id: "scopes",
						label: "Scopes",
						value: OAUTH_SCOPES,
						hint: "Add these under Permissions → Jira API → Configure.",
					},
				],
			},
			{
				id: "credentials",
				title: "Add OAuth credentials",
				description:
					"Copy the Client ID and Secret from Settings in the developer console into the fields below. Keep them secret.",
			},
			{
				id: "auth",
				title: "Authorize Toby",
				description:
					"Click Connect. Toby will open your browser to sign in with Atlassian and return an access token automatically.",
			},
			{
				id: "validate",
				title: "Validate",
				description:
					"Toby will run a health check to confirm the Jira API is reachable and tools are available.",
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
