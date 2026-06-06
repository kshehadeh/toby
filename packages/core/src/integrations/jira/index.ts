import chalk from "chalk";
import { runSharedChatTurn } from "../../chat-pipeline/run-turn";
import type { CredentialsFile } from "../../config/index";
import { readConfig, writeConfig } from "../../config/index";
import type {
	ChatIntegrationReadiness,
	ChatRunOptions,
	CredentialFieldDescriptor,
	IntegrationModule,
	IntegrationToolHealth,
	TestConnectionOptions,
} from "../types";
import { getJiraCredentialsRaw, testJiraConnection } from "./client";
import { createJiraTools } from "./tools";

function hasJiraCredentials(creds: CredentialsFile): boolean {
	return Boolean(
		creds.integrations?.jira?.domain?.trim() &&
			creds.integrations?.jira?.email?.trim() &&
			creds.integrations?.jira?.apiToken?.trim(),
	);
}

const jiraLifecycle = {
	name: "jira" as const,
	displayName: "Jira",
	description: "Atlassian Jira issue tracking",

	async connect(): Promise<void> {
		const config = readConfig();
		if (config.integrations.jira) {
			console.log(
				chalk.yellow(
					"Jira is already connected. Disconnect first to reconnect.",
				),
			);
			return;
		}

		const creds = getJiraCredentialsRaw();
		if (!creds) {
			throw new Error(
				"Jira credentials not found. Run `toby configure` to set your domain, email, and API token.",
			);
		}

		try {
			await testJiraConnection();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Jira credentials are invalid: ${message}`);
		}

		config.integrations.jira = {
			connectedAt: new Date().toISOString(),
			domain: creds.domain,
			email: creds.email,
		};
		writeConfig(config);
		console.log(chalk.green("Jira connected successfully!"));
	},

	async isConnected(): Promise<boolean> {
		const config = readConfig();
		return !!config.integrations.jira;
	},

	async testConnection(options?: TestConnectionOptions) {
		const connected = await jiraLifecycle.isConnected();
		if (!connected) {
			return {
				ok: false,
				details:
					"Jira is not connected. Run `toby connect jira` after configuring your credentials.",
			};
		}

		try {
			await testJiraConnection();
			if (!options?.validateTools) {
				return {
					ok: true,
					details: "Jira API reachable and authenticated.",
				};
			}
			const toolChecks = await validateJiraTools();
			const failedChecks = toolChecks.filter((check) => !check.ok);

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
				details: `Connected, but Jira API check failed: ${message}`,
			};
		}
	},

	async disconnect(): Promise<void> {
		const config = readConfig();
		if (!config.integrations.jira) {
			console.log(chalk.yellow("Jira is not connected."));
			return;
		}
		Reflect.deleteProperty(config.integrations, "jira");
		writeConfig(config);
		console.log(chalk.green("Jira disconnected."));
	},
};

function getCredentialDescriptors(): CredentialFieldDescriptor[] {
	return [
		{
			key: "jira.domain",
			label: "Atlassian Domain",
			kind: "value",
		},
		{ key: "jira.email", label: "Email", kind: "value" },
		{ key: "jira.apiToken", label: "API Token", masked: true },
	];
}

function seedCredentialValues(creds: CredentialsFile): Record<string, string> {
	const out: Record<string, string> = {};
	const domain = creds.integrations?.jira?.domain?.trim();
	if (domain) out["jira.domain"] = domain;
	const email = creds.integrations?.jira?.email?.trim();
	if (email) out["jira.email"] = email;
	const apiToken = creds.integrations?.jira?.apiToken?.trim();
	if (apiToken) out["jira.apiToken"] = apiToken;
	return out;
}

function mergeCredentialsPatch(
	values: Record<string, string>,
	previous: CredentialsFile,
): Partial<CredentialsFile> {
	const domain =
		values["jira.domain"] ?? previous.integrations?.jira?.domain ?? "";
	const email =
		values["jira.email"] ?? previous.integrations?.jira?.email ?? "";
	const apiToken =
		values["jira.apiToken"] ?? previous.integrations?.jira?.apiToken ?? "";
	return {
		integrations: {
			...(previous.integrations ?? {}),
			jira: {
				...(previous.integrations?.jira ?? {}),
				domain,
				email,
				apiToken,
			},
		},
	};
}

function chatReadiness(
	creds: CredentialsFile,
): Promise<ChatIntegrationReadiness> {
	if (hasJiraCredentials(creds)) return Promise.resolve({ ok: true });
	return Promise.resolve({
		ok: false,
		hint: "Add Jira credentials (domain, email, API token) in `toby configure` or run `toby connect jira`.",
	});
}

async function chat(options: ChatRunOptions): Promise<void> {
	const persona = options.personaForModel;
	const dryRun = options.dryRun;

	console.log(chalk.cyan(`Jira chat (persona "${persona.name}")...`));
	if (dryRun) {
		console.log(chalk.yellow("  (dry run - changes will not be applied)"));
	}
	console.log(chalk.dim(`  Goal: ${options.prompt}`));
	console.log();

	const result = await runSharedChatTurn(
		[jiraIntegrationModule],
		[
			{
				role: "system",
				content: buildJiraSystemMessage(persona),
			},
			{ role: "user", content: options.prompt },
		],
		{ persona, dryRun },
	);

	for (const line of result.appliedActions) {
		console.log(chalk.green(`+ ${line}`));
	}

	if (result.text?.trim()) {
		console.log();
		console.log(chalk.bold("Result"));
		console.log(result.text.trim());
	}

	console.log();
	console.log(chalk.green("Done."));
}

function buildJiraSystemMessage(persona: {
	name: string;
	instructions: string;
}): string {
	return `You are assisting with Jira issue tracking. Use the available tools to search issues, get issue details, read comments, and list projects. All tools are read-only — you can look up information but cannot create or modify issues.

Persona: ${persona.name}${persona.instructions ? `\nInstructions: ${persona.instructions}` : ""}`;
}

export const jiraIntegrationModule: IntegrationModule = {
	...jiraLifecycle,
	capabilities: ["chat"],
	providerCategories: ["work_tracker"],
	resources: ["issues", "projects"],
	chatReadiness,
	createChatTools: ({ dryRun }) => {
		const ctx = { dryRun, appliedActions: [] as string[] };
		return {
			tools: createJiraTools(ctx),
			appliedActions: ctx.appliedActions,
		};
	},
	chatModelPrep: {
		systemPromptSection: `### Jira
You can search and read Jira issues and projects. Use searchJiraIssues for JQL-based searches, getJiraIssue for full issue details, getJiraIssueComments for issue comments, and listJiraProjects for accessible projects. All operations are read-only.`,
		async buildSingleSessionMessages(persona, userPrompt) {
			return [
				{
					role: "system" as const,
					content: buildJiraSystemMessage(persona),
				},
				...(userPrompt.trim()
					? ([{ role: "user" as const, content: userPrompt }] as const)
					: []),
			];
		},
		async buildMultiUserContent(userPrompt) {
			return `## Jira context
The user may want to look up Jira issues or projects. Use searchJiraIssues, getJiraIssue, getJiraIssueComments, or listJiraProjects as needed. Query: "${userPrompt.slice(0, 200)}"`;
		},
	},
	getCredentialDescriptors,
	seedCredentialValues,
	mergeCredentialsPatch,
	chat,
};

async function validateJiraTools(): Promise<IntegrationToolHealth[]> {
	const availableTools = new Set(
		Object.keys(createJiraTools({ dryRun: true, appliedActions: [] })),
	);
	const toolNames = [
		"searchJiraIssues",
		"getJiraIssue",
		"getJiraIssueComments",
		"listJiraProjects",
	];

	return toolNames.map((name) => ({
		tool: name,
		ok: availableTools.has(name),
		details: availableTools.has(name)
			? "Tool is available."
			: "Tool is not available in the Jira toolset.",
	}));
}
