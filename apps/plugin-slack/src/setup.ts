import {
	DEFAULT_REDIRECT_URI,
	OAUTH_USER_SCOPES,
	runSlackOAuthFlow,
} from "./auth";
import { mergeOAuthTokens } from "./tokens";

type JsonRecord = Record<string, unknown>;
export const SLACK_BOT_SCOPES = [
	"chat:write",
	"app_mentions:read",
	"channels:read",
	"channels:history",
	"groups:read",
	"groups:history",
	"im:read",
	"im:history",
	"im:write",
	"mpim:read",
	"mpim:history",
	"users:read",
	"users:read.email",
];

export function buildSlackManifest() {
	return {
		display_information: { name: "Toby" },
		features: {
			bot_user: { display_name: "Toby", always_online: true },
			app_home: {
				home_tab_enabled: false,
				messages_tab_enabled: true,
				messages_tab_read_only_enabled: false,
			},
		},
		oauth_config: {
			redirect_urls: [DEFAULT_REDIRECT_URI],
			scopes: { user: OAUTH_USER_SCOPES.split(","), bot: SLACK_BOT_SCOPES },
			pkce_enabled: true,
		},
		settings: {
			event_subscriptions: {
				bot_events: [
					"app_mention",
					"message.channels",
					"message.groups",
					"message.im",
					"message.mpim",
				],
			},
			interactivity: { is_enabled: true },
			org_deploy_enabled: false,
			socket_mode_enabled: true,
			token_rotation_enabled: false,
		},
	};
}

export function slackAppCreationUrl(): string {
	return `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(buildSlackManifest()))}`;
}

function field(config: JsonRecord, key: string): string {
	return typeof config[key] === "string" ? config[key].trim() : "";
}

async function api(method: string, token: string) {
	const response = await fetch(`https://slack.com/api/${method}`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(15_000),
	});
	const data = (await response.json()) as JsonRecord;
	if (!response.ok || data.ok !== true) {
		throw new Error(
			`Slack ${method}: ${typeof data.error === "string" ? data.error : response.status}`,
		);
	}
	return {
		data,
		scopes: response.headers
			.get("x-oauth-scopes")
			?.split(",")
			.map((s) => s.trim()),
	};
}

/** Validates drafts without touching user files. Core persists only successful stages. */
export async function validateSlackSetup(
	config: JsonRecord,
	options: JsonRecord,
) {
	const stage = options.stage;
	let patch: JsonRecord = {};
	if (stage === "oauth") {
		const clientId = field(config, "clientId");
		if (!clientId)
			throw new Error("Enter the Client ID from Basic Information.");
		const tokens = await runSlackOAuthFlow({
			clientId,
			redirectUri: field(config, "redirectUri") || undefined,
		});
		if (field(config, "teamId") && tokens.teamId !== field(config, "teamId")) {
			throw new Error("Choose the same Slack workspace as the bot connection.");
		}
		patch = mergeOAuthTokens(config, {
			...tokens,
			clientId,
			clientSecret: field(config, "clientSecret"),
			redirectUri: field(config, "redirectUri"),
		});
		patch.authMethod = "oauth";
		const authorizedConfig = { ...config, ...patch };
		const { data, scopes } = await api(
			"auth.test",
			field(authorizedConfig, "oauthUserToken"),
		);
		if (scopes && !scopes.includes("search:read"))
			throw new Error(
				"User authorization is missing search:read. Update the app's user scopes and authorize again.",
			);
		return {
			ok: true,
			config: patch,
			details: { teamId: data.team_id, teamName: data.team, userTools: true },
		};
	}
	if (stage !== "bot") throw new Error("Unsupported Slack setup stage.");
	const bot = field(config, "botToken") || field(config, "oauthBotToken");
	if (!bot.startsWith("xoxb-"))
		throw new Error(
			"Add a Bot User OAuth Token starting with xoxb- from OAuth & Permissions.",
		);
	const { data, scopes } = await api("auth.test", bot);
	if (!data.bot_id)
		throw new Error("This token does not identify a Slack bot.");
	const required =
		options.inbound === true
			? ["chat:write", "app_mentions:read", "im:history"]
			: ["chat:write"];
	const missing = scopes
		? required.filter((scope) => !scopes.includes(scope))
		: [];
	if (missing.length)
		throw new Error(
			`Missing bot scopes: ${missing.join(", ")}. Update permissions and reinstall the Slack app.`,
		);
	if (options.inbound === true) {
		const app = field(config, "appToken");
		if (!app.startsWith("xapp-"))
			throw new Error(
				"Add an App-Level Token starting with xapp- with connections:write from Basic Information.",
			);
		// This only validates Socket Mode access. A real inbound event is still required.
		await api("apps.connections.open", app);
	}
	const previousTeam = field(config, "teamId");
	if (
		field(config, "oauthUserToken") &&
		previousTeam &&
		previousTeam !== data.team_id
	) {
		throw new Error(
			"This bot belongs to a different workspace from the saved user authorization. Disconnect Slack before switching workspaces.",
		);
	}
	patch = {
		botUserId: data.user_id,
		teamId: data.team_id,
		teamName: data.team,
	};
	return {
		ok: true,
		config: patch,
		details: {
			teamId: data.team_id,
			teamName: data.team,
			botUserId: data.user_id,
			inboundCredentials: options.inbound === true,
		},
	};
}
