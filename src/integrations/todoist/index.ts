import chalk from "chalk";
import type { Command } from "commander";
import type { CredentialsFile } from "../../config/index";
import { readConfig, writeConfig } from "../../config/index";
import type {
	ChatRunOptions,
	CredentialFieldDescriptor,
	IntegrationModule,
	IntegrationToolHealth,
	SummarizeRunOptions,
	SummarizeRunResult,
} from "../types";
import { runTodoistChatTurn } from "./chat-turn";
import {
	fetchCompletedTasks,
	fetchOpenTasks,
	testTodoistConnection,
} from "./client";
import {
	buildTodoistChatSystemMessage,
	buildTodoistChatUserMessage,
} from "./prompts/chat";
import {
	buildTodoistSummarySystemMessage,
	buildTodoistSummaryUserMessage,
} from "./prompts/summarize";
import { createTodoistTools } from "./tools";

function hasTodoistApiKey(creds: CredentialsFile): boolean {
	return Boolean(
		creds.integrations?.todoist?.apiKey?.trim() ||
			creds.todoist?.apiKey?.trim(),
	);
}

const todoistLifecycle = {
	name: "todoist" as const,
	displayName: "Todoist",
	description: "Connect to Todoist to manage and summarize your tasks",

	async connect(): Promise<void> {
		const config = readConfig();
		if (config.integrations.todoist) {
			console.log(
				chalk.yellow(
					"Todoist is already connected. Disconnect first to reconnect.",
				),
			);
			return;
		}

		try {
			await testTodoistConnection();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(
				`Todoist credentials are invalid or missing permissions: ${message}`,
			);
		}

		config.integrations.todoist = { connectedAt: new Date().toISOString() };
		writeConfig(config);
		console.log(chalk.green("Todoist connected successfully!"));
	},

	async isConnected(): Promise<boolean> {
		const config = readConfig();
		return !!config.integrations.todoist;
	},

	async testConnection() {
		const connected = await todoistLifecycle.isConnected();
		if (!connected) {
			return {
				ok: false,
				details:
					"Todoist is not connected. Run `toby connect todoist` after configuring your API key.",
			};
		}

		try {
			await testTodoistConnection();
			const toolChecks = await validateTodoistTools();
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
				details: `Connected, but Todoist API check failed: ${message}`,
			};
		}
	},

	async disconnect(): Promise<void> {
		const config = readConfig();
		if (!config.integrations.todoist) {
			console.log(chalk.yellow("Todoist is not connected."));
			return;
		}
		Reflect.deleteProperty(config.integrations, "todoist");
		writeConfig(config);
		console.log(chalk.green("Todoist disconnected."));
	},
};

function getCredentialDescriptors(): CredentialFieldDescriptor[] {
	return [{ key: "todoist.apiKey", label: "API Key", masked: true }];
}

function seedCredentialValues(creds: CredentialsFile): Record<string, string> {
	const out: Record<string, string> = {};
	const apiKey =
		creds.integrations?.todoist?.apiKey?.trim() ||
		creds.todoist?.apiKey?.trim();
	if (apiKey) out["todoist.apiKey"] = apiKey;
	return out;
}

function mergeCredentialsPatch(
	values: Record<string, string>,
	previous: CredentialsFile,
): Partial<CredentialsFile> {
	const apiKey =
		values["todoist.apiKey"] ??
		previous.integrations?.todoist?.apiKey ??
		previous.todoist?.apiKey ??
		"";
	return {
		integrations: {
			...(previous.integrations ?? {}),
			todoist: {
				...(previous.integrations?.todoist ?? {}),
				apiKey,
			},
		},
		todoist: {
			apiKey,
		},
	};
}

async function summarize(
	options: SummarizeRunOptions,
): Promise<SummarizeRunResult> {
	const openTasks = await fetchOpenTasks(options.maxResults);
	const completedTasks = await fetchCompletedTasks(
		Math.min(20, options.maxResults),
	);

	if (openTasks.length === 0 && completedTasks.length === 0) {
		return {
			status: "empty",
			message: "No Todoist tasks found to summarize.",
		};
	}

	const messages = [
		buildTodoistSummarySystemMessage(options.summaryPersona),
		buildTodoistSummaryUserMessage(openTasks, completedTasks),
	];
	return { status: "ok", messages };
}

async function chat(options: ChatRunOptions): Promise<void> {
	const persona = options.personaForModel;
	const dryRun = options.dryRun;

	console.log(chalk.cyan(`Todoist chat (persona "${persona.name}")...`));
	console.log(chalk.dim(`  AI: ${persona.ai.provider}/${persona.ai.model}`));
	if (persona.instructions) {
		console.log(chalk.dim(`  Instructions: ${persona.instructions}`));
	}
	if (dryRun) {
		console.log(chalk.yellow("  (dry run - changes will not be applied)"));
	}
	console.log(chalk.dim(`  Goal: ${options.prompt}`));
	console.log();

	const openTasks = await fetchOpenTasks(options.maxResults);
	const completedTasks = await fetchCompletedTasks(options.maxResults);

	if (openTasks.length === 0 && completedTasks.length === 0) {
		console.log(chalk.green("No Todoist tasks found."));
		return;
	}

	console.log(
		chalk.dim(
			`Loaded ${openTasks.length} open task(s), ${completedTasks.length} completed in the last 30 days.\n`,
		),
	);

	const messages = [
		buildTodoistChatSystemMessage(persona),
		buildTodoistChatUserMessage(openTasks, completedTasks),
	];

	const result = await runTodoistChatTurn({
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

export const todoistIntegrationModule: IntegrationModule = {
	...todoistLifecycle,
	capabilities: ["summarize", "chat"],
	resources: ["tasks", "projects"],
	chatReadiness: async (creds) => {
		if (await todoistLifecycle.isConnected()) return { ok: true };
		// Configure-only setup is allowed (API key in creds without `toby connect todoist`).
		return hasTodoistApiKey(creds)
			? { ok: true }
			: {
					ok: false,
					hint: "Add a Todoist API key in `toby configure` or run `toby connect todoist`.",
				};
	},
	createChatTools: ({ dryRun }) => {
		const ctx = { dryRun, appliedActions: [] as string[] };
		return {
			tools: createTodoistTools(ctx),
			appliedActions: ctx.appliedActions,
		};
	},
	runChatTurn: runTodoistChatTurn,
	chatModelPrep: {
		systemPromptSection: `### Todoist
You are assisting with Todoist. Use Todoist tools to create, read, or update tasks. Open/completed task snapshots may appear in the user message below. Never claim a task changed unless the corresponding Todoist tool succeeded.`,
		async buildSingleSessionMessages(persona, userPrompt) {
			const openTasks = await fetchOpenTasks();
			const completedTasks = await fetchCompletedTasks();
			return [
				buildTodoistChatSystemMessage(persona),
				buildTodoistChatUserMessage(openTasks, completedTasks),
				...(userPrompt.trim()
					? ([
							{ role: "user", content: `User request:\n${userPrompt}` },
						] as const)
					: []),
			];
		},
		async buildMultiUserContent(_userPrompt) {
			const openTasks = await fetchOpenTasks();
			const completedTasks = await fetchCompletedTasks();
			const todoistUser = buildTodoistChatUserMessage(
				openTasks,
				completedTasks,
			);
			const todoistContent =
				typeof todoistUser.content === "string"
					? todoistUser.content
					: JSON.stringify(todoistUser.content);
			return `## Todoist context and instructions
Apply the system instruction using Todoist tools when tasks are involved.

${todoistContent}`;
		},
	},
	getCredentialDescriptors,
	seedCredentialValues,
	mergeCredentialsPatch,
	summarize,
	chat,
	registerCommands(_program: Command) {
		// Todoist-specific CLI subcommands can be registered here later.
	},
};

async function validateTodoistTools(): Promise<IntegrationToolHealth[]> {
	const checks: IntegrationToolHealth[] = [];
	const availableTools = new Set(
		Object.keys(createTodoistTools({ dryRun: true, appliedActions: [] })),
	);

	try {
		await fetchOpenTasks(1);
		checks.push({
			tool: "fetchOpenTasks",
			ok: true,
			details: "Fetched open tasks successfully.",
		});
	} catch (error) {
		checks.push({
			tool: "fetchOpenTasks",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	try {
		await fetchCompletedTasks(1);
		checks.push({
			tool: "fetchCompletedTasks",
			ok: true,
			details: "Fetched completed tasks successfully.",
		});
	} catch (error) {
		checks.push({
			tool: "fetchCompletedTasks",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	checks.push({
		tool: "completeTask",
		ok: availableTools.has("completeTask"),
		details: availableTools.has("completeTask")
			? "Write endpoint assumed available with the same API key (not executed)."
			: "Tool is not available in the Todoist toolset.",
	});
	checks.push({
		tool: "updateTask",
		ok: availableTools.has("updateTask"),
		details: availableTools.has("updateTask")
			? "Write endpoint assumed available with the same API key (not executed)."
			: "Tool is not available in the Todoist toolset.",
	});
	checks.push({
		tool: "createTask",
		ok: availableTools.has("createTask"),
		details: availableTools.has("createTask")
			? "Write endpoint assumed available with the same API key (not executed)."
			: "Tool is not available in the Todoist toolset.",
	});

	return checks;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
