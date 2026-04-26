import chalk from "chalk";
import type { Command } from "commander";
import type { CoreMessage } from "../ai/chat";
import { chatWithTools, createModelForPersona } from "../ai/chat";
import type { Persona } from "../config/index";
import { fetchUnreadInbox } from "../integrations/gmail/client";
import {
	buildEmailUserMessage,
	buildSystemMessage,
} from "../integrations/gmail/prompts/organize";
import {
	type EmailContext,
	createGmailTools,
} from "../integrations/gmail/tools";
import {
	getIntegrationModule,
	getModulesWithCapability,
} from "../integrations/index";
import { listPersonas, resolvePersona } from "../personas/index";

interface OrganizeOptions {
	persona?: string;
	maxResults: string;
	dryRun?: boolean;
}

const DEFAULT_ORGANIZE_PERSONA: Persona = {
	name: "default-organize",
	instructions: "",
	promptMode: "add",
	ai: {
		provider: "openai",
		model: "gpt-5-mini",
	},
};

const MUTATING_GMAIL_TOOLS = new Set([
	"createAndApplyLabel",
	"applyMultipleLabels",
	"markAsRead",
	"archiveEmail",
]);

export function registerOrganizeCommand(program: Command): void {
	program
		.command("organize <integration>")
		.description("Organize an integration's relevant data")
		.option("-p, --persona <name>", "Optional persona to shape organization")
		.option(
			"-n, --max-results <number>",
			"Maximum number of items to include for organization",
			"20",
		)
		.option(
			"--dry-run",
			"Show what would happen without applying changes",
			false,
		)
		.action(async (integrationName: string, options: OrganizeOptions) => {
			try {
				const module = getIntegrationModule(integrationName);
				if (!module) {
					console.error(chalk.red(`Unknown integration: ${integrationName}`));
					process.exitCode = 1;
					return;
				}

				if (!module.capabilities.includes("organize")) {
					const supported = getModulesWithCapability("organize").map(
						(m) => m.name,
					);
					console.error(
						chalk.red(
							`Organize is not available for "${module.name}". Supported: ${supported.join(", ") || "(none)"}.`,
						),
					);
					process.exitCode = 1;
					return;
				}

				const persona = resolveOrganizePersona(options.persona);
				if (!persona) {
					process.exitCode = 1;
					return;
				}

				switch (module.name) {
					case "gmail":
						await organizeGmail(persona, options);
						return;
					default:
						console.error(
							chalk.red(
								`Organize is declared for "${module.name}" but no runner is implemented yet.`,
							),
						);
						process.exitCode = 1;
						return;
				}
			} catch (error) {
				console.error(
					chalk.red(error instanceof Error ? error.message : String(error)),
				);
				process.exitCode = 1;
			}
		});
}

async function organizeGmail(
	persona: Persona,
	options: OrganizeOptions,
): Promise<void> {
	const maxResults = Number.parseInt(options.maxResults, 10);
	const dryRun = Boolean(options.dryRun);

	console.log(
		chalk.cyan(`Organizing Gmail inbox with persona "${persona.name}"...`),
	);
	console.log(chalk.dim(`  AI: ${persona.ai.provider}/${persona.ai.model}`));
	if (persona.instructions) {
		console.log(chalk.dim(`  Instructions: ${persona.instructions}`));
	}
	if (dryRun) {
		console.log(chalk.yellow("  (dry run - changes will not be applied)"));
	}
	console.log();

	console.log(chalk.cyan(`Fetching up to ${maxResults} unread emails...`));
	const messages = await fetchUnreadInbox(maxResults);
	if (messages.length === 0) {
		console.log(chalk.green("No unread emails in your inbox!"));
		return;
	}
	console.log(chalk.dim(`Found ${messages.length} unread email(s)\n`));

	const model = createModelForPersona(persona);
	const conversation: CoreMessage[] = [buildSystemMessage(persona)];
	const ctx: EmailContext = {
		currentEmail: null,
		dryRun,
		appliedActions: [],
	};
	const tools = createGmailTools(ctx);

	for (let i = 0; i < messages.length; i++) {
		const email = messages[i];
		ctx.currentEmail = email;

		console.log(
			chalk.dim(`[${i + 1}/${messages.length}] `) +
				chalk.white(email.subject || "(no subject)"),
		);

		conversation.push(buildEmailUserMessage(email));

		const result = await chatWithTools(model, conversation, tools);
		const appliedActionsForEmail = [...ctx.appliedActions];
		const mutatingToolCalls = result.toolCalls.filter((tc) =>
			MUTATING_GMAIL_TOOLS.has(tc.name),
		);
		const confirmedMutation = appliedActionsForEmail.length > 0;

		for (const action of appliedActionsForEmail) {
			console.log(chalk.green(`  + ${action}`));
		}
		ctx.appliedActions.length = 0;

		if (!confirmedMutation) {
			const noChangeExplanation = extractNoChangeExplanation(result.text);
			if (noChangeExplanation) {
				console.log(
					chalk.yellow(`  ! No changes made: ${noChangeExplanation}`),
				);
			}
			if (mutatingToolCalls.length > 0) {
				console.log(
					chalk.yellow(
						"  ! Attempted inbox changes, but no successful Gmail modification was confirmed.",
					),
				);
			} else if (!noChangeExplanation) {
				console.log(
					chalk.yellow(
						"  ! No inbox changes were applied because no mutating tool calls were made.",
					),
				);
			}
		}

		if (result.text && confirmedMutation) {
			console.log(chalk.dim(`  ${result.text}`));
		}

		for (const tc of result.toolCalls) {
			console.log(chalk.blue(`  -> ${tc.name}(${formatArgs(tc.args)})`));
		}

		conversation.push({
			role: "assistant",
			content:
				result.text ||
				`Applied tools: ${result.toolCalls.map((tc) => tc.name).join(", ")}`,
		});
		console.log();
	}

	console.log(chalk.green(`Done! Processed ${messages.length} email(s).`));
}

function resolveOrganizePersona(personaName?: string): Persona | null {
	if (!personaName) {
		return DEFAULT_ORGANIZE_PERSONA;
	}

	const persona = resolvePersona(personaName);
	if (persona) {
		return persona;
	}

	console.error(
		chalk.red(`Persona "${personaName}" not found. Available personas:`),
	);
	for (const p of listPersonas()) {
		console.error(chalk.dim(`  - ${p.name} (${p.ai.provider}/${p.ai.model})`));
	}

	return null;
}

function formatArgs(args: Record<string, unknown>): string {
	return Object.entries(args)
		.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
		.join(", ");
}

function extractNoChangeExplanation(text: string): string | null {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return null;
	}

	const lower = normalized.toLowerCase();
	const hasNoChangeCue =
		lower.includes("no changes") ||
		lower.includes("no change") ||
		lower.includes("did not make changes") ||
		lower.includes("didn't make changes");

	const hasActionClaim =
		lower.includes("applied") ||
		lower.includes("archived") ||
		lower.includes("labeled") ||
		lower.includes("labelled") ||
		lower.includes("marked as read") ||
		lower.includes("organized");

	if (!hasNoChangeCue || hasActionClaim) {
		return null;
	}

	return normalized;
}
