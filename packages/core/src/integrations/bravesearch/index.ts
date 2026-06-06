import chalk from "chalk";
import { runSharedChatTurn } from "../../chat-pipeline/run-turn";
import type { CredentialsFile } from "../../config/index";
import { readConfig, writeConfig } from "../../config/index";
import type {
	ChatRunOptions,
	CredentialFieldDescriptor,
	IntegrationModule,
	IntegrationToolHealth,
	TestConnectionOptions,
} from "../types";
import { testBraveSearchConnection, webSearch } from "./client";
import { createBraveSearchTools } from "./tools";

function hasBraveSearchApiKey(creds: CredentialsFile): boolean {
	return Boolean(creds.integrations?.bravesearch?.apiKey?.trim());
}

const braveSearchLifecycle = {
	name: "bravesearch" as const,
	displayName: "Brave Search",
	description: "Search the web using the Brave Search API",

	async connect(): Promise<void> {
		const config = readConfig();
		if (config.integrations.bravesearch) {
			console.log(
				chalk.yellow(
					"Brave Search is already connected. Disconnect first to reconnect.",
				),
			);
			return;
		}

		try {
			await testBraveSearchConnection();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Brave Search credentials are invalid: ${message}`);
		}

		config.integrations.bravesearch = { connectedAt: new Date().toISOString() };
		writeConfig(config);
		console.log(chalk.green("Brave Search connected successfully!"));
	},

	async isConnected(): Promise<boolean> {
		const config = readConfig();
		return !!config.integrations.bravesearch;
	},

	async testConnection(options?: TestConnectionOptions) {
		const connected = await braveSearchLifecycle.isConnected();
		if (!connected) {
			return {
				ok: false,
				details:
					"Brave Search is not connected. Run `toby connect bravesearch` after configuring your API key.",
			};
		}

		try {
			await testBraveSearchConnection();
			if (!options?.validateTools) {
				return {
					ok: true,
					details: "Brave Search API reachable.",
				};
			}
			const toolChecks = await validateBraveSearchTools();
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
				details: `Connected, but Brave Search API check failed: ${message}`,
			};
		}
	},

	async disconnect(): Promise<void> {
		const config = readConfig();
		if (!config.integrations.bravesearch) {
			console.log(chalk.yellow("Brave Search is not connected."));
			return;
		}
		Reflect.deleteProperty(config.integrations, "bravesearch");
		writeConfig(config);
		console.log(chalk.green("Brave Search disconnected."));
	},
};

function getCredentialDescriptors(): CredentialFieldDescriptor[] {
	return [{ key: "bravesearch.apiKey", label: "API Key", masked: true }];
}

function seedCredentialValues(creds: CredentialsFile): Record<string, string> {
	const out: Record<string, string> = {};
	const apiKey = creds.integrations?.bravesearch?.apiKey?.trim();
	if (apiKey) out["bravesearch.apiKey"] = apiKey;
	return out;
}

function mergeCredentialsPatch(
	values: Record<string, string>,
	previous: CredentialsFile,
): Partial<CredentialsFile> {
	const apiKey =
		values["bravesearch.apiKey"] ??
		previous.integrations?.bravesearch?.apiKey ??
		"";
	return {
		integrations: {
			...(previous.integrations ?? {}),
			bravesearch: {
				...(previous.integrations?.bravesearch ?? {}),
				apiKey,
			},
		},
	};
}

async function chat(options: ChatRunOptions): Promise<void> {
	const persona = options.personaForModel;
	const dryRun = options.dryRun;

	console.log(chalk.cyan(`Brave Search chat (persona "${persona.name}")...`));
	if (dryRun) {
		console.log(chalk.yellow("  (dry run - changes will not be applied)"));
	}
	console.log(chalk.dim(`  Goal: ${options.prompt}`));
	console.log();

	const result = await runSharedChatTurn(
		[braveSearchIntegrationModule],
		[
			{
				role: "system",
				content: buildBraveSearchSystemMessage(persona),
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

function buildBraveSearchSystemMessage(persona: {
	name: string;
	instructions: string;
}): string {
	return `You are assisting with web search via Brave Search. Use the webSearch tool to find information when the user asks questions that require looking up facts, current events, or research. Summarize and synthesize search results clearly, citing source URLs when relevant.

Persona: ${persona.name}${persona.instructions ? `\nInstructions: ${persona.instructions}` : ""}`;
}

export const braveSearchIntegrationModule: IntegrationModule = {
	...braveSearchLifecycle,
	capabilities: ["chat"],
	providerCategories: ["search"],
	resources: ["web search"],
	chatReadiness: async (creds) => {
		if (await braveSearchLifecycle.isConnected()) return { ok: true };
		return hasBraveSearchApiKey(creds)
			? { ok: true }
			: {
					ok: false,
					hint: "Add a Brave Search API key in `toby configure` or run `toby connect bravesearch`.",
				};
	},
	createChatTools: ({ dryRun }) => {
		const ctx = { dryRun, appliedActions: [] as string[] };
		return {
			tools: createBraveSearchTools(ctx),
			appliedActions: ctx.appliedActions,
		};
	},
	chatModelPrep: {
		systemPromptSection: `### Brave Search
You can search the web using the webSearch tool. Use it when the user asks about current events, facts, research, or anything that requires up-to-date information from the web. Always cite source URLs from search results.`,
		async buildSingleSessionMessages(persona, userPrompt) {
			return [
				{
					role: "system" as const,
					content: buildBraveSearchSystemMessage(persona),
				},
				...(userPrompt.trim()
					? ([{ role: "user" as const, content: userPrompt }] as const)
					: []),
			];
		},
		async buildMultiUserContent(userPrompt) {
			return `## Brave Search context
The user may want to search the web. Use webSearch when current information or research is needed. Query: "${userPrompt.slice(0, 200)}"`;
		},
	},
	getCredentialDescriptors,
	seedCredentialValues,
	mergeCredentialsPatch,
	chat,
};

async function validateBraveSearchTools(): Promise<IntegrationToolHealth[]> {
	const checks: IntegrationToolHealth[] = [];
	const availableTools = new Set(
		Object.keys(createBraveSearchTools({ dryRun: true, appliedActions: [] })),
	);

	try {
		await webSearch("test", { count: 1 });
		checks.push({
			tool: "webSearch",
			ok: true,
			details: "Brave Search API responded successfully.",
		});
	} catch (error) {
		checks.push({
			tool: "webSearch",
			ok: availableTools.has("webSearch"),
			details: availableTools.has("webSearch")
				? "Tool is available but API test failed (credentials may be invalid)."
				: "Tool is not available in the Brave Search toolset.",
		});
	}

	return checks;
}
