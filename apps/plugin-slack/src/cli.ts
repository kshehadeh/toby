#!/usr/bin/env bun
/**
 * Slack installable Toby plugin (protocol v1).
 * Build: bun run build (from this directory) or `bun run build:plugin:slack` from repo root.
 */

import {
	DEFAULT_REDIRECT_URI,
	OAUTH_USER_SCOPES,
	runSlackOAuthFlow,
} from "./auth";
import {
	listConversations,
	searchConversations,
	searchSlackUsers,
	testSlackConnection,
} from "./client";
import {
	getSlackAuthMethod,
	hasSlackAccessToken,
	hasSlackOAuthClientCreds,
	isConnected,
	normalizeConfig,
} from "./config";
import { runInbound } from "./inbound-run";
import {
	SLACK_MULTI_USER_CONTENT_TEMPLATE,
	SLACK_SINGLE_SESSION_RULES,
	SLACK_SINGLE_SESSION_USER_TEMPLATE,
	SLACK_SYSTEM_PROMPT_SECTION,
} from "./prompts";
import { emitError, emitJson, parseEnvelope, readStdin } from "./protocol";
import { consumeTokenRefreshPatch, mergeOAuthTokens } from "./tokens";
import { TOOL_DEFINITIONS, executeTool } from "./tools";

type JsonRecord = Record<string, unknown>;

const PLUGIN_VERSION = "1.0.0";
const PROTOCOL_VERSION = "1";
const DISPLAY_NAME = "Slack";
const DESCRIPTION =
	"Connect to Slack to post messages, reply in threads, and search channels";

function buildChatModelPrep() {
	return {
		systemPromptSection: SLACK_SYSTEM_PROMPT_SECTION,
		singleSessionRules: SLACK_SINGLE_SESSION_RULES,
		singleSessionUserTemplate: SLACK_SINGLE_SESSION_USER_TEMPLATE,
		multiUserContentTemplate: SLACK_MULTI_USER_CONTENT_TEMPLATE,
	};
}

function buildChatReadiness(
	config: JsonRecord,
	state: JsonRecord,
): { ok: boolean; hint?: string } {
	if (state.connectedAt) {
		return { ok: true };
	}
	const authMethod = getSlackAuthMethod(config);
	if (authMethod === "bot_token" && hasSlackAccessToken(config)) {
		return { ok: true };
	}
	if (authMethod === "oauth" && hasSlackAccessToken(config)) {
		return { ok: true };
	}
	if (authMethod === "oauth" && hasSlackOAuthClientCreds(config)) {
		return {
			ok: false,
			hint: "Run `toby connect slack` to complete OAuth.",
		};
	}
	return {
		ok: false,
		hint:
			authMethod === "bot_token"
				? "Add a Slack bot token in `toby configure` or run `toby connect slack`."
				: "Add Slack OAuth client ID/secret in `toby configure`, then run `toby connect slack`.",
	};
}

function buildInboundPrep() {
	return {
		externalKeyFormat: "slack:{teamId}:{channelId}:{threadRootTs}",
		transportLabel: "Slack Socket Mode",
	};
}

async function validateSlackTools(
	config: JsonRecord,
): Promise<Array<{ tool: string; ok: boolean; details: string }>> {
	const checks: Array<{ tool: string; ok: boolean; details: string }> = [];
	const availableTools = new Set(TOOL_DEFINITIONS.map((t) => t.name));

	try {
		await testSlackConnection(config);
		checks.push({
			tool: "auth.test",
			ok: true,
			details: "Authenticated with Slack successfully.",
		});
	} catch (error) {
		checks.push({
			tool: "auth.test",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	try {
		const channels = await listConversations(config, 5);
		checks.push({
			tool: "searchChannels",
			ok: true,
			details: `Listed ${channels.length} conversation(s).`,
		});
	} catch (error) {
		checks.push({
			tool: "searchChannels",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	try {
		const sample = await searchConversations(config, "", 3);
		checks.push({
			tool: "searchChannels.query",
			ok: true,
			details: `Resolved ${sample.channels.length} channel(s) and ${sample.users.length} user(s).`,
		});
	} catch (error) {
		checks.push({
			tool: "searchChannels.query",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	try {
		const users = await searchSlackUsers(config, "", 3);
		checks.push({
			tool: "searchUsers",
			ok: true,
			details: `Resolved ${users.users.length} user(s).`,
		});
	} catch (error) {
		checks.push({
			tool: "searchUsers",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	for (const toolName of ["postToChannel", "replyToPost", "searchMessages"]) {
		checks.push({
			tool: toolName,
			ok: availableTools.has(toolName),
			details: availableTools.has(toolName)
				? "Tool is registered (write/search not executed in status check)."
				: "Tool is not available in the Slack toolset.",
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
		name: "slack",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		version: PLUGIN_VERSION,
		protocolVersion: PROTOCOL_VERSION,
		icon: "💬",
		inboundTransport: "socket_mode",
		connected,
		capabilities: ["chat", "inbound"],
		providerCategories: ["chat"],
		resources: ["channels", "messages", "users"],
		authMethods: [
			{ id: "oauth", label: "OAuth (recommended)", isDefault: true },
			{ id: "bot_token", label: "Manual bot token" },
		],
		chatModelPrep: buildChatModelPrep(),
		chatReadiness: buildChatReadiness(config, state),
		inboundPrep: buildInboundPrep(),
		details: connected
			? "Slack API reachable."
			: "Slack is not connected. Run `toby connect slack` after configuring credentials.",
	};

	if (state.connectedAt) {
		try {
			const auth = await testSlackConnection(config);
			const teamLabel = auth.team ? ` (${auth.team})` : "";
			payload.details = `Slack API reachable${teamLabel}.`;
		} catch (error) {
			payload.ok = false;
			payload.details = `Connected, but Slack API check failed: ${toErrorMessage(error)}`;
		}
	}

	if (validateTools && state.connectedAt) {
		const toolChecks = await validateSlackTools(config);
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
	const authMethod = getSlackAuthMethod(config);

	if (authMethod === "oauth") {
		const clientId = String(config.clientId ?? "").trim();
		const clientSecret = String(config.clientSecret ?? "").trim();
		const redirectUri = String(config.redirectUri ?? "").trim() || undefined;
		if (!clientId || !clientSecret) {
			emitJson({
				ok: false,
				reason:
					"Slack OAuth requires clientId and clientSecret. Set them in `toby configure`.",
			});
		}

		try {
			const tokens = await runSlackOAuthFlow({
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
			await testSlackConnection(mergedConfig);
			emitJson({
				ok: true,
				reason: "Slack connected successfully.",
				config: configPatch,
			});
		} catch (error) {
			emitJson({ ok: false, reason: toErrorMessage(error) });
		}
	}

	try {
		await testSlackConnection(config);
		emitJson({
			ok: true,
			reason: "Slack connected successfully.",
			config: normalizeConfig(config),
		});
	} catch (error) {
		emitJson({
			ok: false,
			reason: `Slack bot token is invalid or missing permissions: ${toErrorMessage(error)}`,
		});
	}
}

function handleDisconnect(config: JsonRecord): never {
	emitJson({
		ok: true,
		reason: "Slack disconnected.",
		config: {
			...normalizeConfig(config),
			oauthBotToken: "",
			oauthUserToken: "",
			oauthUserRefreshToken: "",
			oauthBotRefreshToken: "",
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
				label: "OAuth Client ID",
				type: "string",
				required: false,
				showForAuthMethods: ["oauth"],
			},
			{
				key: "clientSecret",
				label: "OAuth Client Secret",
				type: "string",
				required: false,
				masked: true,
				showForAuthMethods: ["oauth"],
			},
			{
				key: "redirectUri",
				label: "OAuth Redirect URI (optional)",
				type: "string",
				required: false,
				showForAuthMethods: ["oauth"],
			},
			{
				key: "botToken",
				label: "Bot Token (xoxb-...) — required for daemon/inbound",
				type: "string",
				required: false,
				masked: true,
				showForAuthMethods: ["bot_token"],
				showForInbound: true,
			},
			{
				key: "appToken",
				label:
					"App Token (xapp-...) — Socket Mode (inbound; pair with bot token)",
				type: "string",
				required: false,
				masked: true,
			},
			{
				key: "botUserId",
				label: "Bot User ID (optional; from auth.test)",
				type: "string",
				required: false,
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
			authMethod: getSlackAuthMethod(config),
		},
	});
}

function handleConfigSet(): never {
	emitJson({ ok: true, reason: "Slack config synced." });
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
		name: "slack",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		steps: [
			{
				id: "overview",
				title: "What Slack can do in Toby",
				description:
					"Connect Toby to a Slack workspace so you can post messages, reply in threads, search channels and users, and receive @mention messages in Toby via Socket Mode.",
			},
			{
				id: "provider",
				title: "Create a Slack app",
				description:
					"Open the Slack API site and create a new app from scratch. Choose your workspace, then go to OAuth & Permissions to add the redirect URL and user scopes. Install the app to your workspace before returning to Toby.",
				links: [
					{
						label: "Create Slack app",
						url: "https://api.slack.com/apps",
					},
				],
				artifacts: [
					{
						id: "redirectUri",
						label: "Redirect URI",
						value: DEFAULT_REDIRECT_URI,
						hint: "Add this to OAuth & Permissions → Redirect URLs.",
					},
					{
						id: "scopes",
						label: "User scopes",
						value: OAUTH_USER_SCOPES,
						hint: "Add these under OAuth & Permissions → User Scopes.",
					},
				],
			},
			{
				id: "credentials",
				title: "Add OAuth credentials",
				description:
					"Copy the Client ID and Client Secret from the Basic Information page into the fields below. Keep them secret.",
			},
			{
				id: "auth",
				title: "Authorize Toby",
				description:
					"Click Connect. Toby will open your browser to sign in with Slack and return an access token automatically.",
			},
			{
				id: "validate",
				title: "Validate",
				description:
					"Toby will run a health check to confirm the Slack API is reachable and tools are available.",
			},
		],
	});
}

async function main(): Promise<void> {
	const [command, subcommand] = process.argv.slice(2);

	if (command === "inbound" && subcommand === "run") {
		await runInbound();
		return;
	}

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
