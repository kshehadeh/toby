import chalk from "chalk";
import type { Command } from "commander";
import {
	type CoreMessage,
	chatWithTools,
	createModelForPersona,
} from "../../ai/chat";
import { listPersonas, resolvePersona } from "../../personas/index";
import { type GmailMessage, fetchUnreadInbox } from "./client";
import { buildEmailUserMessage, buildSystemMessage } from "./prompts/organize";
import { type EmailContext, createGmailTools } from "./tools";

export function registerGmailCommands(program: Command): void {
	const gmail = program
		.command("gmail")
		.description("Gmail integration commands");

	gmail
		.command("fetch")
		.description("Fetch unread emails from your inbox")
		.option(
			"-n, --max-results <number>",
			"Maximum number of emails to fetch",
			"20",
		)
		.action(async (options) => {
			try {
				const maxResults = Number.parseInt(options.maxResults, 10);
				console.log(
					chalk.cyan(`Fetching up to ${maxResults} unread emails...\n`),
				);

				const messages = await fetchUnreadInbox(maxResults);

				if (messages.length === 0) {
					console.log(chalk.green("No unread emails in your inbox!"));
					return;
				}

				console.log(chalk.bold(`Found ${messages.length} unread email(s):\n`));
				for (const msg of messages) {
					printMessage(msg);
				}
			} catch (err) {
				console.error(
					chalk.red(err instanceof Error ? err.message : String(err)),
				);
			}
		});

	gmail
		.command("organize")
		.description("Organize your inbox using an AI persona")
		.option("-p, --persona <name>", "Persona to use for organizing")
		.option(
			"-n, --max-results <number>",
			"Maximum number of emails to process",
			"20",
		)
		.option(
			"--dry-run",
			"Show what would happen without applying changes",
			false,
		)
		.action(async (options) => {
			try {
				const personaName = options.persona;
				if (!personaName) {
					const personas = listPersonas();
					if (personas.length === 0) {
						console.error(
							chalk.red(
								"No personas configured. Run `toby configure` to create one.",
							),
						);
						return;
					}
					console.error(
						chalk.red("--persona is required. Available personas:"),
					);
					for (const p of personas) {
						console.error(
							chalk.dim(`  - ${p.name} (${p.ai.provider}/${p.ai.model})`),
						);
					}
					return;
				}

				const persona = resolvePersona(personaName);
				if (!persona) {
					console.error(
						chalk.red(
							`Persona "${personaName}" not found. Run \`toby configure\` to create it.`,
						),
					);
					return;
				}

				const maxResults = Number.parseInt(options.maxResults, 10);
				const dryRun = options.dryRun as boolean;

				console.log(
					chalk.cyan(`Organizing inbox with persona "${persona.name}"...`),
				);
				console.log(
					chalk.dim(`  AI: ${persona.ai.provider}/${persona.ai.model}`),
				);
				if (persona.instructions) {
					console.log(chalk.dim(`  Instructions: ${persona.instructions}`));
				}
				if (dryRun) {
					console.log(
						chalk.yellow("  (dry run — changes will not be applied)"),
					);
				}
				console.log();

				console.log(
					chalk.cyan(`Fetching up to ${maxResults} unread emails...`),
				);
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

					if (result.text) {
						console.log(chalk.dim(`  ${result.text}`));
					}

					for (const action of ctx.appliedActions) {
						console.log(chalk.green(`  ✓ ${action}`));
					}
					ctx.appliedActions.length = 0;

					for (const tc of result.toolCalls) {
						console.log(chalk.blue(`  → ${tc.name}(${formatArgs(tc.args)})`));
					}

					conversation.push({
						role: "assistant",
						content:
							result.text ||
							`Applied tools: ${result.toolCalls.map((tc) => tc.name).join(", ")}`,
					});
					console.log();
				}

				console.log(
					chalk.green(`Done! Processed ${messages.length} email(s).`),
				);
			} catch (err) {
				console.error(
					chalk.red(err instanceof Error ? err.message : String(err)),
				);
			}
		});
}

function printMessage(msg: GmailMessage): void {
	console.log(chalk.bold.white(`  ${msg.subject || "(no subject)"}`));
	console.log(chalk.dim(`  From: ${msg.from}`));
	console.log(chalk.dim(`  Date: ${msg.date}`));
	console.log(chalk.dim(`  ${msg.snippet}`));
	console.log();
}

function formatArgs(args: Record<string, unknown>): string {
	return Object.entries(args)
		.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
		.join(", ");
}
