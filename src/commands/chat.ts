import chalk from "chalk";
import type { Command } from "commander";
import type { Persona } from "../config/index";
import type { IntegrationModule } from "../integrations/types";
import { listPersonas, resolvePersona } from "../personas/index";
import { prepareChatSessionMessages } from "../ui/chat/prepare-messages";
import { runIntegrationChatTurn } from "../ui/chat/run-turn";
import { runChatSessionInk } from "../ui/chat/session";
import {
	parseChatCliInput,
	resolveChatIntegrationModules,
	sortModulesByName,
} from "./chat-integrations";

interface ChatCommandOptions {
	persona?: string;
	dryRun?: boolean;
	noTui?: boolean;
	integration?: string[];
}

const DEFAULT_CHAT_PERSONA: Persona = {
	name: "default-chat",
	instructions: "",
	promptMode: "add",
	ai: {
		provider: "openai",
		model: "gpt-5-mini",
	},
};

function collectIntegration(value: string, previous: string[] = []): string[] {
	return [...previous, value];
}

export function registerChatCommand(program: Command): void {
	program
		.command("chat")
		.description(
			"Chat with connected integrations using AI and tools (Ink TUI with follow-ups; omit prompt to type in the TUI). Pass a chat integration as the first word, or use --integration (repeatable). With no selection, all connected chat integrations are used. Use --no-tui for one-shot console output.",
		)
		.argument(
			"[words...]",
			"Optional: first word may be an integration name (gmail, todoist, azuread); remaining words are the prompt. If the first word is not an integration, the full text is the prompt and all connected chat integrations are used.",
		)
		.option("-p, --persona <name>", "Optional persona to shape behavior")
		.option(
			"-i, --integration <name>",
			"Include this integration (repeatable). When set, positional words are only the prompt.",
			collectIntegration,
			[],
		)
		.option(
			"--dry-run",
			"Show what would happen without applying changes",
			false,
		)
		.option(
			"--no-tui",
			"Skip the Ink session; run a single console turn (no follow-ups in TUI)",
			false,
		)
		.action(
			async (words: string[] | undefined, options: ChatCommandOptions) => {
				try {
					const positional = Array.isArray(words) ? words : [];
					const flagIntegrations = options.integration ?? [];
					const { explicitNames, prompt } = parseChatCliInput(
						positional,
						flagIntegrations,
					);

					const resolved = await resolveChatIntegrationModules(explicitNames);
					if (!resolved.ok) {
						console.error(chalk.red(resolved.message));
						process.exitCode = 1;
						return;
					}

					const modules = sortModulesByName(resolved.modules);

					const persona = resolveChatPersona(options.persona);
					if (!persona) {
						process.exitCode = 1;
						return;
					}

					const dryRun = Boolean(options.dryRun);
					if (options.noTui) {
						if (!prompt) {
							console.error(
								chalk.red(
									'With --no-tui, pass a prompt (e.g. toby chat --no-tui "summarize unread" or toby chat gmail --no-tui "archive promos").',
								),
							);
							process.exitCode = 1;
							return;
						}
						if (modules.length === 1) {
							const only = modules[0];
							const chat = only?.chat;
							if (!only || !chat) {
								console.error(
									chalk.red(
										"Internal error: single module has no chat handler.",
									),
								);
								process.exitCode = 1;
								return;
							}
							await chat({
								prompt,
								dryRun,
								personaForModel: persona,
							});
							return;
						}

						await runCombinedConsoleChatTurn({
							modules,
							prompt,
							persona,
							dryRun,
						});
						return;
					}

					await runChatSessionInk({
						modules,
						persona,
						dryRun,
						initialUserPrompt: prompt,
					});
				} catch (error) {
					console.error(
						chalk.red(error instanceof Error ? error.message : String(error)),
					);
					process.exitCode = 1;
				}
			},
		);
}

async function runCombinedConsoleChatTurn(params: {
	readonly modules: readonly IntegrationModule[];
	readonly prompt: string;
	readonly persona: Persona;
	readonly dryRun: boolean;
}): Promise<void> {
	const { modules, prompt, persona, dryRun } = params;
	const names = modules.map((m) => m.name).join(", ");

	console.log(chalk.cyan(`Chat (${names}) — persona "${persona.name}"…`));
	console.log(chalk.dim(`  AI: ${persona.ai.provider}/${persona.ai.model}`));
	if (persona.instructions) {
		console.log(chalk.dim(`  Instructions: ${persona.instructions}`));
	}
	if (dryRun) {
		console.log(chalk.yellow("  (dry run - changes will not be applied)"));
	}
	console.log(chalk.dim(`  Goal: ${prompt}`));
	console.log();

	const messages = await prepareChatSessionMessages(modules, persona, prompt);
	const moduleNames = modules.map((m) => m.name);

	console.log(chalk.cyan("Running assistant…\n"));

	const result = await runIntegrationChatTurn(moduleNames, messages, {
		persona,
		dryRun,
	});

	for (const action of result.appliedActions) {
		console.log(chalk.green(`+ ${action}`));
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
		console.log(chalk.bold("Assistant"));
		console.log(result.text.trim());
	}

	console.log();
	console.log(chalk.green("Done."));
}

function resolveChatPersona(personaName?: string): Persona | null {
	if (!personaName) {
		return DEFAULT_CHAT_PERSONA;
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
