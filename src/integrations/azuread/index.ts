import chalk from "chalk";
import type { CredentialsFile } from "../../config/index";
import { readConfig, writeConfig } from "../../config/index";
import type {
	ChatRunOptions,
	CredentialFieldDescriptor,
	IntegrationModule,
	IntegrationToolHealth,
} from "../types";
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
		Reflect.deleteProperty(config.integrations, "azuread");
		writeConfig(config);
		console.log(chalk.green("Azure AD disconnected."));
	},
};

function getCredentialDescriptors(): CredentialFieldDescriptor[] {
	return [
		{ key: "azuread.tenantId", label: "Tenant ID", masked: false },
		{ key: "azuread.clientId", label: "Client ID", masked: false },
		{ key: "azuread.clientSecret", label: "Client Secret", masked: true },
	];
}

function seedCredentialValues(creds: CredentialsFile): Record<string, string> {
	const out: Record<string, string> = {};
	if (creds.azuread?.tenantId) out["azuread.tenantId"] = creds.azuread.tenantId;
	if (creds.azuread?.clientId) out["azuread.clientId"] = creds.azuread.clientId;
	if (creds.azuread?.clientSecret)
		out["azuread.clientSecret"] = creds.azuread.clientSecret;
	return out;
}

function mergeCredentialsPatch(
	values: Record<string, string>,
	previous: CredentialsFile,
): Partial<CredentialsFile> {
	return {
		azuread: {
			tenantId: values["azuread.tenantId"] ?? previous.azuread?.tenantId ?? "",
			clientId: values["azuread.clientId"] ?? previous.azuread?.clientId ?? "",
			clientSecret:
				values["azuread.clientSecret"] ?? previous.azuread?.clientSecret ?? "",
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
	resources: ["users"],
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
		throw new Error(
			`Token missing permissions: ${diag.missing.join(
				", ",
			)}. Ensure your app has admin-consented Microsoft Graph application permissions: ${getRequiredAzureAdGraphPermissions().join(
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
