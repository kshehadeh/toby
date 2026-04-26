import chalk from "chalk";
import type { Command } from "commander";
import type { CredentialsFile } from "../../config/index";
import { readConfig, writeConfig } from "../../config/index";
import type {
	CredentialFieldDescriptor,
	IntegrationModule,
	IntegrationToolHealth,
	SummarizeRunOptions,
	SummarizeRunResult,
} from "../types";
import {
	fetchCompletedTasks,
	fetchOpenTasks,
	testTodoistConnection,
} from "./client";
import {
	buildTodoistSummarySystemMessage,
	buildTodoistSummaryUserMessage,
} from "./prompts/summarize";
import { createTodoistTools } from "./tools";

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
	if (creds.todoist?.apiKey) out["todoist.apiKey"] = creds.todoist.apiKey;
	return out;
}

function mergeCredentialsPatch(
	values: Record<string, string>,
	previous: CredentialsFile,
): Partial<CredentialsFile> {
	return {
		todoist: {
			apiKey: values["todoist.apiKey"] ?? previous.todoist?.apiKey ?? "",
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

export const todoistIntegrationModule: IntegrationModule = {
	...todoistLifecycle,
	capabilities: ["summarize"],
	resources: ["tasks", "projects"],
	getCredentialDescriptors,
	seedCredentialValues,
	mergeCredentialsPatch,
	summarize,
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
		tool: "updateTaskData",
		ok: availableTools.has("updateTaskData"),
		details: availableTools.has("updateTaskData")
			? "Write endpoint assumed available with the same API key (not executed)."
			: "Tool is not available in the Todoist toolset.",
	});

	return checks;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
