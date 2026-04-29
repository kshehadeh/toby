import chalk from "chalk";
import type { CredentialsFile } from "../../config/index";
import {
	getAzureAdAuthMethod,
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
import { runAzureAdOAuthPkceFlow } from "./auth";
import { runAzureAdChatTurn } from "./chat-turn";
import {
	getGraphAccessToken,
	getRequiredAzureAdGraphPermissions,
	getTokenPermissionDiagnostics,
	testAzureAdConnection,
} from "./client";
import {
	buildAzureAdChatSystemMessage,
	buildAzureAdChatUserMessage,
} from "./prompts/chat";
import { createAzureAdTools } from "./tools";

function hasAzureAdCredentials(creds: CredentialsFile): boolean {
	const authMethod = getAzureAdAuthMethod(creds);
	const hasTenantAndClient = Boolean(
		(creds.integrations?.azuread?.tenantId?.trim() ||
			creds.azuread?.tenantId?.trim()) &&
			(creds.integrations?.azuread?.clientId?.trim() ||
				creds.azuread?.clientId?.trim()),
	);
	if (!hasTenantAndClient) return false;
	if (authMethod === "oauth_pkce") return true;
	return Boolean(
		creds.integrations?.azuread?.clientSecret?.trim() ||
			creds.azuread?.clientSecret?.trim(),
	);
}

const azureAdLifecycle = {
	name: "azuread" as const,
	displayName: "Azure AD",
	description:
		"Connect to Microsoft Entra ID (Azure AD) via Microsoft Graph to look up users and teams",

	async connect(): Promise<void> {
		const config = readConfig();
		if (config.integrations.azuread) {
			console.log(
				chalk.yellow(
					"Azure AD is already connected. Disconnect first to reconnect.",
				),
			);
			return;
		}

		console.log(chalk.cyan("Connecting Azure AD (Microsoft Graph)..."));
		console.log(chalk.dim("Ensure credentials are set via `toby configure`."));
		const credentials = readCredentials();
		const authMethod = getAzureAdAuthMethod(credentials);
		if (authMethod === "oauth_pkce") {
			const tenantId =
				credentials.integrations?.azuread?.tenantId ??
				credentials.azuread?.tenantId ??
				"";
			const clientId =
				credentials.integrations?.azuread?.clientId ??
				credentials.azuread?.clientId ??
				"";
			const redirectUri =
				credentials.integrations?.azuread?.redirectUri ??
				credentials.azuread?.redirectUri;
			if (!tenantId.trim() || !clientId.trim()) {
				throw new Error(
					"Azure AD OAuth requires tenantId and clientId. Set them in `toby configure`.",
				);
			}

			const tokens = await runAzureAdOAuthPkceFlow({
				tenantId,
				clientId,
				redirectUri,
			});
			writeCredentials({
				...credentials,
				integrations: {
					...(credentials.integrations ?? {}),
					azuread: {
						...(credentials.integrations?.azuread ?? {}),
						authMethod: "oauth_pkce",
						redirectUri: redirectUri ?? "",
						oauthAccessToken: tokens.accessToken,
						oauthRefreshToken: tokens.refreshToken,
						oauthExpiresAt: new Date(tokens.expiresAtMs).toISOString(),
					},
				},
				azuread: {
					...(credentials.azuread ?? {}),
					authMethod: "oauth_pkce",
					tenantId,
					clientId,
					clientSecret:
						credentials.integrations?.azuread?.clientSecret ??
						credentials.azuread?.clientSecret,
					redirectUri: redirectUri ?? "",
					oauthAccessToken: tokens.accessToken,
					oauthRefreshToken: tokens.refreshToken,
					oauthExpiresAt: new Date(tokens.expiresAtMs).toISOString(),
				},
			});
		}

		await validateAzureAdConnectivity();

		config.integrations.azuread = { connectedAt: new Date().toISOString() };
		writeConfig(config);
		console.log(chalk.green("Azure AD connected successfully!"));
	},

	async isConnected(): Promise<boolean> {
		const config = readConfig();
		return !!config.integrations.azuread;
	},

	async testConnection() {
		const connected = await azureAdLifecycle.isConnected();
		if (!connected) {
			return {
				ok: false,
				details:
					"Azure AD is not connected. Run `toby connect azuread` after configuring credentials.",
			};
		}

		try {
			await testAzureAdConnection();
			const toolChecks = await validateAzureAdTools();
			const failedChecks = toolChecks.filter((c) => !c.ok);
			return {
				ok: failedChecks.length === 0,
				details:
					failedChecks.length === 0
						? `Successfully authenticated and validated ${toolChecks.length}/${toolChecks.length} tools.`
						: `Connected, but ${failedChecks.length}/${toolChecks.length} tool checks failed.`,
				tools: toolChecks,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				ok: false,
				details: `Connected, but Graph API check failed: ${message}`,
			};
		}
	},

	async disconnect(): Promise<void> {
		const config = readConfig();
		if (!config.integrations.azuread) {
			console.log(chalk.yellow("Azure AD is not connected."));
			return;
		}
		const creds = readCredentials();
		if (creds.integrations?.azuread || creds.azuread) {
			writeCredentials({
				...creds,
				integrations: {
					...(creds.integrations ?? {}),
					azuread: {
						...(creds.integrations?.azuread ?? {}),
						oauthAccessToken: "",
						oauthRefreshToken: "",
						oauthExpiresAt: "",
					},
				},
				azuread: {
					...(creds.azuread ?? {}),
					oauthAccessToken: "",
					oauthRefreshToken: "",
					oauthExpiresAt: "",
				},
			});
		}
		Reflect.deleteProperty(config.integrations, "azuread");
		writeConfig(config);
		console.log(chalk.green("Azure AD disconnected."));
	},
};

function getCredentialDescriptors(): CredentialFieldDescriptor[] {
	return [
		{ key: "azuread.tenantId", label: "Tenant ID", masked: false },
		{ key: "azuread.clientId", label: "Client ID", masked: false },
		{
			key: "azuread.redirectUri",
			label: "OAuth Redirect URI (optional)",
			masked: false,
			showForAuthMethods: ["oauth_pkce"],
		},
		{
			key: "azuread.clientSecret",
			label: "Client Secret",
			masked: true,
			showForAuthMethods: ["client_credentials"],
		},
	];
}

function seedCredentialValues(creds: CredentialsFile): Record<string, string> {
	const out: Record<string, string> = {};
	const tenantId =
		creds.integrations?.azuread?.tenantId?.trim() ||
		creds.azuread?.tenantId?.trim();
	const clientId =
		creds.integrations?.azuread?.clientId?.trim() ||
		creds.azuread?.clientId?.trim();
	const clientSecret =
		creds.integrations?.azuread?.clientSecret?.trim() ||
		creds.azuread?.clientSecret?.trim();
	const redirectUri =
		creds.integrations?.azuread?.redirectUri?.trim() ||
		creds.azuread?.redirectUri?.trim();
	const authMethod = getAzureAdAuthMethod(creds);
	out["azuread.authMethod"] = authMethod;
	if (tenantId) out["azuread.tenantId"] = tenantId;
	if (clientId) out["azuread.clientId"] = clientId;
	if (clientSecret) out["azuread.clientSecret"] = clientSecret;
	if (redirectUri) out["azuread.redirectUri"] = redirectUri;
	return out;
}

function mergeCredentialsPatch(
	values: Record<string, string>,
	previous: CredentialsFile,
): Partial<CredentialsFile> {
	const tenantId =
		values["azuread.tenantId"] ??
		previous.integrations?.azuread?.tenantId ??
		previous.azuread?.tenantId ??
		"";
	const clientId =
		values["azuread.clientId"] ??
		previous.integrations?.azuread?.clientId ??
		previous.azuread?.clientId ??
		"";
	const clientSecret =
		values["azuread.clientSecret"] ??
		previous.integrations?.azuread?.clientSecret ??
		previous.azuread?.clientSecret ??
		"";
	const redirectUri =
		values["azuread.redirectUri"] ??
		previous.integrations?.azuread?.redirectUri ??
		previous.azuread?.redirectUri ??
		"";
	const authMethod = getAzureAdAuthMethod(
		previous,
		values["azuread.authMethod"],
		clientSecret,
	);
	return {
		integrations: {
			...(previous.integrations ?? {}),
			azuread: {
				...(previous.integrations?.azuread ?? {}),
				authMethod,
				tenantId,
				clientId,
				clientSecret,
				redirectUri,
			},
		},
		azuread: {
			authMethod,
			tenantId,
			clientId,
			clientSecret,
			redirectUri,
		},
	};
}

async function chat(options: ChatRunOptions): Promise<void> {
	const persona = options.personaForModel;
	const dryRun = options.dryRun;

	console.log(chalk.cyan(`Azure AD chat (persona "${persona.name}")...`));
	console.log(chalk.dim(`  AI: ${persona.ai.provider}/${persona.ai.model}`));
	if (persona.instructions) {
		console.log(chalk.dim(`  Instructions: ${persona.instructions}`));
	}
	if (dryRun) {
		console.log(chalk.yellow("  (dry run - changes will not be applied)"));
	}
	console.log(chalk.dim(`  Goal: ${options.prompt}`));
	console.log();

	const messages = [
		buildAzureAdChatSystemMessage(persona),
		buildAzureAdChatUserMessage(options.prompt),
	];

	const result = await runAzureAdChatTurn({
		messages,
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

export const azureAdIntegrationModule: IntegrationModule = {
	...azureAdLifecycle,
	capabilities: ["chat"],
	authMethods: [
		{ id: "oauth_pkce", label: "OAuth (PKCE)", isDefault: true },
		{ id: "client_credentials", label: "Client Credentials" },
	],
	resources: ["users"],
	chatReadiness: async (creds) => {
		if (await azureAdLifecycle.isConnected()) return { ok: true };
		// Azure AD can be configured via `toby configure` and then connected (stores connectedAt).
		return hasAzureAdCredentials(creds)
			? {
					ok: false,
					hint: "Run `toby connect azuread` after configuring Azure AD credentials.",
				}
			: {
					ok: false,
					hint: "Add Azure AD tenantId/clientId (OAuth) or tenantId/clientId/clientSecret (client credentials) in `toby configure`, then run `toby connect azuread`.",
				};
	},
	createChatTools: ({ dryRun }) => {
		const ctx = { dryRun, appliedActions: [] as string[] };
		return {
			tools: createAzureAdTools(ctx),
			appliedActions: ctx.appliedActions,
		};
	},
	runChatTurn: runAzureAdChatTurn,
	chatModelPrep: {
		systemPromptSection: `### Azure AD
You are assisting with Azure AD (Microsoft Entra ID) via Microsoft Graph. Use tools to look up users and Teams metadata. Never claim a user/team exists unless confirmed by tool results.`,
		async buildSingleSessionMessages(persona, userPrompt) {
			return [
				buildAzureAdChatSystemMessage(persona),
				buildAzureAdChatUserMessage(userPrompt),
			];
		},
		async buildMultiUserContent(userPrompt) {
			return `## Azure AD
Use Microsoft Graph tools to resolve users/teams mentioned by the user request.

User request (may also mention other integrations):
${userPrompt || "(no additional text — follow the system instruction.)"}`;
		},
	},
	getCredentialDescriptors,
	seedCredentialValues,
	mergeCredentialsPatch,
	chat,
};

async function validateAzureAdConnectivity(): Promise<void> {
	const { accessToken, claims } = await getGraphAccessToken();
	if (!accessToken) {
		throw new Error("Could not obtain Graph access token.");
	}
	const diag = getTokenPermissionDiagnostics(claims);
	if (diag.missing.length > 0) {
		const modeHelp =
			diag.mode === "delegated"
				? "Ensure delegated Microsoft Graph permissions are granted and consented."
				: "Ensure your app has admin-consented Microsoft Graph application permissions.";
		throw new Error(
			`Token missing permissions: ${diag.missing.join(
				", ",
			)}. ${modeHelp} Required: ${getRequiredAzureAdGraphPermissions().join(
				", ",
			)}.`,
		);
	}

	await testAzureAdConnection();
}

async function validateAzureAdTools(): Promise<IntegrationToolHealth[]> {
	const checks: IntegrationToolHealth[] = [];

	try {
		const { claims } = await getGraphAccessToken();
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
		await testAzureAdConnection();
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
