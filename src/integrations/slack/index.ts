import chalk from "chalk";
import { formatPersonaAiLabel } from "../../ai/model-factory";
import { runSharedChatTurn } from "../../chat-pipeline/run-turn";
import type { CredentialsFile } from "../../config/index";
import {
	getSlackAuthMethod,
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "../../config/index";
import type {
	ChatRunOptions,
	CredentialFieldDescriptor,
	IntegrationModule,
	IntegrationToolHealth,
} from "../types";
import { runSlackOAuthFlow } from "./auth";
import {
	listConversations,
	searchConversations,
	searchSlackUsers,
	testSlackConnection,
} from "./client";
import {
	buildSlackChatSystemMessage,
	buildSlackChatUserMessage,
} from "./prompts/chat";
import { persistSlackOAuthTokens } from "./tokens";
import { slackChatInboundProvider } from "./inbound";
import { createSlackTools } from "./tools";

type SlackAuthMethod = "oauth" | "bot_token";

function hasSlackAccessToken(creds: CredentialsFile): boolean {
	return Boolean(
		creds.integrations?.slack?.botToken?.trim() ||
			creds.integrations?.slack?.oauthBotToken?.trim() ||
			creds.integrations?.slack?.oauthUserToken?.trim() ||
			creds.slack?.botToken?.trim() ||
			creds.slack?.oauthBotToken?.trim() ||
			creds.slack?.oauthUserToken?.trim(),
	);
}

function hasSlackOAuthClientCreds(creds: CredentialsFile): boolean {
	return Boolean(
		(creds.integrations?.slack?.clientId?.trim() ||
			creds.slack?.clientId?.trim()) &&
			(creds.integrations?.slack?.clientSecret?.trim() ||
				creds.slack?.clientSecret?.trim()),
	);
}

const slackLifecycle = {
	name: "slack" as const,
	displayName: "Slack",
	description:
		"Connect to Slack to post messages, reply in threads, and search channels",

	async connect(): Promise<void> {
		const config = readConfig();
		if (config.integrations.slack) {
			console.log(
				chalk.yellow(
					"Slack is already connected. Disconnect first to reconnect.",
				),
			);
			return;
		}

		const credentials = readCredentials();
		const authMethod = getSlackAuthMethod(credentials);

		console.log(chalk.cyan("Connecting Slack..."));

		if (authMethod === "oauth") {
			const clientId =
				credentials.integrations?.slack?.clientId ??
				credentials.slack?.clientId ??
				"";
			const clientSecret =
				credentials.integrations?.slack?.clientSecret ??
				credentials.slack?.clientSecret ??
				"";
			const redirectUri =
				credentials.integrations?.slack?.redirectUri ??
				credentials.slack?.redirectUri;
			if (!clientId.trim() || !clientSecret.trim()) {
				throw new Error(
					"Slack OAuth requires clientId and clientSecret. Set them in `toby configure`.",
				);
			}

			const tokens = await runSlackOAuthFlow({
				clientId,
				clientSecret,
				redirectUri,
			});

			if (tokens.tokenType === "user") {
				console.log(
					chalk.dim(
						"Connected with a Slack user token (localhost OAuth). Messages post as your user.",
					),
				);
			}

			persistSlackOAuthTokens({
				accessToken: tokens.accessToken,
				tokenType: tokens.tokenType,
				refreshToken: tokens.refreshToken,
				expiresAt: tokens.expiresAt,
				teamId: tokens.teamId,
				teamName: tokens.teamName,
				clientId,
				clientSecret,
				redirectUri: redirectUri ?? "",
			});
		} else {
			try {
				await testSlackConnection();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(
					`Slack bot token is invalid or missing permissions: ${message}`,
				);
			}
		}

		const prev = config.integrations.slack;
		config.integrations.slack = {
			...(typeof prev === "object" && prev !== null ? prev : {}),
			connectedAt: new Date().toISOString(),
		};
		writeConfig(config);
		console.log(chalk.green("Slack connected successfully!"));
	},

	async isConnected(): Promise<boolean> {
		const config = readConfig();
		return !!config.integrations.slack;
	},

	async testConnection() {
		const connected = await slackLifecycle.isConnected();
		if (!connected) {
			return {
				ok: false,
				details:
					"Slack is not connected. Run `toby connect slack` after configuring credentials.",
			};
		}

		try {
			const auth = await testSlackConnection();
			const toolChecks = await validateSlackTools();
			const failedChecks = toolChecks.filter((check) => !check.ok);
			const teamLabel = auth.team ? ` (${auth.team})` : "";
			return {
				ok: failedChecks.length === 0,
				details:
					failedChecks.length === 0
						? `Successfully authenticated${teamLabel} and validated ${toolChecks.length}/${toolChecks.length} tools.`
						: `Connected${teamLabel}, but ${failedChecks.length}/${toolChecks.length} tool checks failed.`,
				tools: toolChecks,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				ok: false,
				details: `Connected, but Slack API check failed: ${message}`,
			};
		}
	},

	async disconnect(): Promise<void> {
		const config = readConfig();
		if (!config.integrations.slack) {
			console.log(chalk.yellow("Slack is not connected."));
			return;
		}

		const creds = readCredentials();
		if (creds.integrations?.slack || creds.slack) {
			writeCredentials({
				...creds,
				integrations: {
					...(creds.integrations ?? {}),
					slack: {
						...(creds.integrations?.slack ?? {}),
						oauthBotToken: "",
						oauthUserToken: "",
						oauthUserRefreshToken: "",
						oauthBotRefreshToken: "",
						oauthExpiresAt: "",
					},
				},
				slack: {
					...(creds.slack ?? {}),
					oauthBotToken: "",
					oauthUserToken: "",
					oauthUserRefreshToken: "",
					oauthBotRefreshToken: "",
					oauthExpiresAt: "",
				},
			});
		}

		Reflect.deleteProperty(config.integrations, "slack");
		writeConfig(config);
		console.log(chalk.green("Slack disconnected."));
	},
};

function getCredentialDescriptors(): CredentialFieldDescriptor[] {
	return [
		{
			key: "slack.clientId",
			label: "OAuth Client ID",
			masked: false,
			showForAuthMethods: ["oauth"],
		},
		{
			key: "slack.clientSecret",
			label: "OAuth Client Secret",
			masked: true,
			showForAuthMethods: ["oauth"],
		},
		{
			key: "slack.redirectUri",
			label: "OAuth Redirect URI (optional)",
			masked: false,
			showForAuthMethods: ["oauth"],
		},
		{
			key: "slack.botToken",
			label: "Bot Token (xoxb-...) — required for daemon/inbound",
			masked: true,
			showForAuthMethods: ["bot_token"],
			showForInbound: true,
		},
		{
			key: "slack.appToken",
			label: "App Token (xapp-...) — Socket Mode (inbound; pair with bot token)",
			masked: true,
		},
		{
			key: "slack.botUserId",
			label: "Bot User ID (optional; from auth.test)",
			masked: false,
		},
	];
}

function pickSlackCredentialValue(
	previous: CredentialsFile,
	values: Record<string, string>,
	field: "botToken" | "appToken" | "botUserId",
): string {
	const fromValues = values[`slack.${field}`]?.trim();
	if (fromValues) return fromValues;
	return (
		previous.integrations?.slack?.[field]?.trim() ||
		previous.slack?.[field]?.trim() ||
		""
	);
}

function seedCredentialValues(creds: CredentialsFile): Record<string, string> {
	const out: Record<string, string> = {};
	const authMethod = getSlackAuthMethod(creds);
	out["slack.authMethod"] = authMethod;

	const fields = [
		"clientId",
		"clientSecret",
		"redirectUri",
		"botToken",
		"appToken",
		"botUserId",
	] as const;
	for (const field of fields) {
		const v =
			creds.integrations?.slack?.[field]?.trim() ||
			creds.slack?.[field]?.trim();
		if (v) out[`slack.${field}`] = v;
	}
	return out;
}

function mergeCredentialsPatch(
	values: Record<string, string>,
	previous: CredentialsFile,
): Partial<CredentialsFile> {
	const clientId =
		values["slack.clientId"] ??
		previous.integrations?.slack?.clientId ??
		previous.slack?.clientId ??
		"";
	const clientSecret =
		values["slack.clientSecret"] ??
		previous.integrations?.slack?.clientSecret ??
		previous.slack?.clientSecret ??
		"";
	const redirectUri =
		values["slack.redirectUri"] ??
		previous.integrations?.slack?.redirectUri ??
		previous.slack?.redirectUri ??
		"";
	const botToken = pickSlackCredentialValue(previous, values, "botToken");
	const appToken = pickSlackCredentialValue(previous, values, "appToken");
	const botUserId = pickSlackCredentialValue(previous, values, "botUserId");
	const authMethod = getSlackAuthMethod(
		previous,
		values["slack.authMethod"],
		botToken,
	) as SlackAuthMethod;

	return {
		integrations: {
			...(previous.integrations ?? {}),
			slack: {
				...(previous.integrations?.slack ?? {}),
				authMethod,
				clientId,
				clientSecret,
				redirectUri,
				botToken,
				appToken,
				botUserId,
			},
		},
		slack: {
			authMethod,
			clientId,
			clientSecret,
			redirectUri,
			botToken,
			appToken,
			botUserId,
			oauthBotToken:
				previous.integrations?.slack?.oauthBotToken ??
				previous.slack?.oauthBotToken,
			oauthUserToken:
				previous.integrations?.slack?.oauthUserToken ??
				previous.slack?.oauthUserToken,
			oauthUserRefreshToken:
				previous.integrations?.slack?.oauthUserRefreshToken ??
				previous.slack?.oauthUserRefreshToken,
			oauthBotRefreshToken:
				previous.integrations?.slack?.oauthBotRefreshToken ??
				previous.slack?.oauthBotRefreshToken,
			oauthExpiresAt:
				previous.integrations?.slack?.oauthExpiresAt ??
				previous.slack?.oauthExpiresAt,
			teamId: previous.integrations?.slack?.teamId ?? previous.slack?.teamId,
			teamName:
				previous.integrations?.slack?.teamName ?? previous.slack?.teamName,
		},
	};
}

async function chat(options: ChatRunOptions): Promise<void> {
	const persona = options.personaForModel;
	const dryRun = options.dryRun;

	console.log(chalk.cyan(`Slack chat (persona "${persona.name}")...`));
	console.log(chalk.dim(`  AI: ${formatPersonaAiLabel(persona)}`));
	if (persona.instructions) {
		console.log(chalk.dim(`  Instructions: ${persona.instructions}`));
	}
	if (dryRun) {
		console.log(chalk.yellow("  (dry run - changes will not be applied)"));
	}
	console.log(chalk.dim(`  Goal: ${options.prompt}`));
	console.log();

	const messages = [
		buildSlackChatSystemMessage(persona),
		await buildSlackChatUserMessage(options.prompt),
	];

	const result = await runSharedChatTurn([slackIntegrationModule], messages, {
		persona,
		dryRun,
		maxResults: options.maxResults,
	});

	for (const line of result.appliedActions) {
		console.log(chalk.green(`+ ${line}`));
	}

	for (const tc of result.toolCalls) {
		console.log(
			chalk.blue(
				`-> ${tc.name}(${Object.entries(tc.args)
					.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
					.join(", ")})`,
			),
		);
	}

	if (result.text?.trim()) {
		console.log();
		console.log(chalk.bold("Result"));
		console.log(result.text.trim());
	}

	console.log();
	console.log(chalk.green("Done."));
}

export const slackIntegrationModule: IntegrationModule = {
	...slackLifecycle,
	capabilities: ["chat"],
	providerCategories: ["chat"],
	resources: ["channels", "messages", "users"],
	authMethods: [
		{ id: "oauth", label: "OAuth (recommended)", isDefault: true },
		{ id: "bot_token", label: "Manual bot token" },
	],
	chatReadiness: async (creds) => {
		if (await slackLifecycle.isConnected()) return { ok: true };
		const authMethod = getSlackAuthMethod(creds);
		if (authMethod === "bot_token" && hasSlackAccessToken(creds)) {
			return { ok: true };
		}
		if (authMethod === "oauth" && hasSlackAccessToken(creds)) {
			return { ok: true };
		}
		if (authMethod === "oauth" && hasSlackOAuthClientCreds(creds)) {
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
	},
	createChatTools: ({ dryRun }) => {
		const ctx = { dryRun, appliedActions: [] as string[] };
		return { tools: createSlackTools(ctx), appliedActions: ctx.appliedActions };
	},
	chatModelPrep: {
		systemPromptSection: `### Slack
You are assisting with Slack. Use Slack tools to search users (by name or email), search channels, post messages, reply in threads, and search message history. Never claim a message was sent unless the corresponding Slack tool succeeded.`,
		async buildSingleSessionMessages(persona, userPrompt) {
			return [
				buildSlackChatSystemMessage(persona),
				await buildSlackChatUserMessage(userPrompt),
			];
		},
		async buildMultiUserContent(userPrompt) {
			const userMessage = await buildSlackChatUserMessage(userPrompt);
			const content =
				typeof userMessage.content === "string"
					? userMessage.content
					: JSON.stringify(userMessage.content);
			return `## Slack context and instructions
Apply the system instruction using Slack tools when messaging is involved.

${content}`;
		},
	},
	getCredentialDescriptors,
	seedCredentialValues,
	mergeCredentialsPatch,
	chat,
	chatInbound: slackChatInboundProvider,
};

async function validateSlackTools(): Promise<IntegrationToolHealth[]> {
	const checks: IntegrationToolHealth[] = [];
	const availableTools = new Set(
		Object.keys(createSlackTools({ dryRun: true, appliedActions: [] })),
	);

	try {
		await testSlackConnection();
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
		const channels = await listConversations(5);
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
		const sample = await searchConversations("", 3);
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
		const users = await searchSlackUsers("", 3);
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
