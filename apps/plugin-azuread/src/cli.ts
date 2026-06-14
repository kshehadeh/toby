#!/usr/bin/env bun
/**
 * Azure AD installable Toby plugin (protocol v1).
 * Build: bun run build (from this directory) or `bun run build:plugin:azuread` from repo root.
 */

import {
	consumeTokenRefreshPatch,
	getGraphAccessToken,
	getRequiredAzureAdGraphPermissions,
	getTokenPermissionDiagnostics,
	hasAzureAdCredentials,
	normalizeConfig,
	parseAzureAdConfig,
	resolveAuthMethod,
	runOAuthConnect,
	testAzureAdConnection,
	validateAzureAdConnectivity,
} from "./client";
import {
	AZURE_AD_MULTI_USER_CONTENT_TEMPLATE,
	AZURE_AD_SINGLE_SESSION_RULES,
	AZURE_AD_SINGLE_SESSION_USER_TEMPLATE,
	AZURE_AD_SYSTEM_PROMPT_SECTION,
} from "./prompts";
import { emitError, emitJson, parseEnvelope, readStdin } from "./protocol";
import { TOOL_DEFINITIONS, executeTool } from "./tools";

type JsonRecord = Record<string, unknown>;

const PLUGIN_VERSION = "1.0.0";
const PROTOCOL_VERSION = "1";
const DISPLAY_NAME = "Azure AD";
const DESCRIPTION =
	"Connect to Microsoft Entra ID (Azure AD) via Microsoft Graph to look up users and teams";

function isConnected(config: JsonRecord, state: JsonRecord): boolean {
	return Boolean(state.connectedAt) || hasAzureAdCredentials(config);
}

function buildChatModelPrep() {
	return {
		systemPromptSection: AZURE_AD_SYSTEM_PROMPT_SECTION,
		singleSessionRules: AZURE_AD_SINGLE_SESSION_RULES,
		singleSessionUserTemplate: AZURE_AD_SINGLE_SESSION_USER_TEMPLATE,
		multiUserContentTemplate: AZURE_AD_MULTI_USER_CONTENT_TEMPLATE,
	};
}

function buildChatReadiness(
	config: JsonRecord,
	state: JsonRecord,
): { ok: boolean; hint?: string } {
	if (state.connectedAt) {
		return { ok: true };
	}
	if (hasAzureAdCredentials(config)) {
		return {
			ok: false,
			hint: "Run `toby connect azuread` after configuring Azure AD credentials.",
		};
	}
	return {
		ok: false,
		hint: "Add Azure AD tenantId/clientId (OAuth) or tenantId/clientId/clientSecret (client credentials) in `toby configure`, then run `toby connect azuread`.",
	};
}

async function validateAzureAdTools(
	config: JsonRecord,
): Promise<Array<{ tool: string; ok: boolean; details: string }>> {
	const checks: Array<{ tool: string; ok: boolean; details: string }> = [];

	try {
		const creds = parseAzureAdConfig(config);
		const { claims } = await getGraphAccessToken(creds);
		const diag = getTokenPermissionDiagnostics(claims);
		const ok = diag.missing.length === 0;
		checks.push({
			tool: "tokenPermissions",
			ok,
			details: ok
				? `Token permissions OK (${diag.mode}).`
				: `Missing: ${diag.missing.join(", ")} (${diag.mode}).`,
		});
	} catch (error) {
		checks.push({
			tool: "tokenPermissions",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	try {
		const creds = parseAzureAdConfig(config);
		await testAzureAdConnection(creds);
		checks.push({
			tool: "listUsers",
			ok: true,
			details: "Fetched users endpoint successfully.",
		});
	} catch (error) {
		checks.push({
			tool: "listUsers",
			ok: false,
			details: toErrorMessage(error),
		});
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
		name: "azuread",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		version: PLUGIN_VERSION,
		protocolVersion: PROTOCOL_VERSION,
		connected,
		capabilities: ["chat"],
		providerCategories: ["contacts"],
		resources: ["users"],
		authMethods: [
			{ id: "oauth_pkce", label: "OAuth (PKCE)", isDefault: true },
			{ id: "client_credentials", label: "Client Credentials" },
		],
		chatModelPrep: buildChatModelPrep(),
		chatReadiness: buildChatReadiness(config, state),
		details: connected
			? "Graph API reachable."
			: "Azure AD is not connected. Run `toby connect azuread` after configuring credentials.",
	};

	if (state.connectedAt) {
		try {
			await validateAzureAdConnectivity(config);
			payload.details = "Graph API reachable.";
		} catch (error) {
			payload.ok = false;
			payload.details = `Connected, but Graph API check failed: ${toErrorMessage(error)}`;
		}
	}

	if (validateTools && state.connectedAt) {
		const toolChecks = await validateAzureAdTools(config);
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
	const tenantId = String(config.tenantId ?? "").trim();
	const clientId = String(config.clientId ?? "").trim();
	if (!tenantId || !clientId) {
		emitJson({
			ok: false,
			reason:
				"Azure AD requires tenantId and clientId. Set them in `toby configure`.",
		});
	}

	const authMethod = resolveAuthMethod(config);
	let configPatch: Record<string, unknown> = {};

	if (authMethod === "oauth_pkce") {
		try {
			configPatch = await runOAuthConnect(config);
		} catch (error) {
			emitJson({ ok: false, reason: toErrorMessage(error) });
		}
	} else {
		const clientSecret = String(config.clientSecret ?? "").trim();
		if (!clientSecret) {
			emitJson({
				ok: false,
				reason:
					"Azure AD client-credentials auth requires clientSecret. Set it in `toby configure`.",
			});
		}
		configPatch = { authMethod: "client_credentials" };
	}

	const mergedConfig = { ...config, ...configPatch };
	try {
		await validateAzureAdConnectivity(mergedConfig);
	} catch (error) {
		emitJson({ ok: false, reason: toErrorMessage(error) });
	}

	emitJson({
		ok: true,
		reason: "Azure AD connected successfully.",
		config: {
			...normalizeConfig(mergedConfig),
			...configPatch,
		},
	});
}

function handleDisconnect(config: JsonRecord): never {
	emitJson({
		ok: true,
		reason: "Azure AD disconnected.",
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
				key: "tenantId",
				label: "Tenant ID",
				type: "string",
				required: true,
			},
			{
				key: "clientId",
				label: "Client ID",
				type: "string",
				required: true,
			},
			{
				key: "redirectUri",
				label: "OAuth Redirect URI (optional)",
				type: "string",
				required: false,
				showForAuthMethods: ["oauth_pkce"],
			},
			{
				key: "clientSecret",
				label: "Client Secret",
				type: "string",
				required: false,
				masked: true,
				showForAuthMethods: ["client_credentials"],
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
	emitJson({ ok: true, reason: "Azure AD config synced." });
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

	if (!TOOL_DEFINITIONS.some((t) => t.name === tool)) {
		emitJson({ ok: false, error: `Unknown tool: ${tool}` });
	}

	try {
		const { result, config: configPatch } = await executeTool(
			tool,
			input,
			config,
		);
		const response: JsonRecord = { ok: true, result };
		const tokenPatch = configPatch ?? consumeTokenRefreshPatch();
		if (tokenPatch) {
			response.config = tokenPatch;
		}
		emitJson(response);
	} catch (error) {
		emitJson({ ok: false, error: toErrorMessage(error) });
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

	emitError(`Unknown command: ${command ?? "(none)"}`, "usage", 2);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	emitError(message, "internal_error", 2);
});
