import { formatPersonaAiLabel } from "@toby/core/ai/model-factory";
import { wrapUserPromptWithPretreatment } from "@toby/core/ai/pretreatment";
import {
	beginRecording,
	beginReplay,
	flushRecording,
	getRecordingFilePath,
} from "@toby/core/ai/replay";
import {
	parseChatCliInput,
	resolveChatIntegrationModules,
	sortModulesByName,
} from "@toby/core/chat-integrations";
import type { Persona } from "@toby/core/config/index";
import type { IntegrationModule } from "@toby/core/integrations/types";
import {
	DEFAULT_CHAT_PERSONA,
	listPersonas,
	resolveDefaultPersona,
	resolvePersona,
} from "@toby/core/personas/index";
import {
	injectSkillBodiesIntoFirstSystemMessage,
	prepareChatSessionMessages,
} from "@toby/core/prepare-messages";
import { loadLocalSkills } from "@toby/core/skills/index";
import chalk from "chalk";
import type { Command } from "commander";
import { runIntegrationChatTurn } from "../ui/chat/run-turn";
import { runChatSessionInk } from "../ui/chat/session";
import { getSkillDebugTextLines } from "../ui/chat/skill-debug";

interface ChatCommandOptions {
	persona?: string;
	prompt?: string;
	dryRun?: boolean;
	noTui?: boolean;
	debug?: boolean;
	integration?: string[];
	record?: string;
	replay?: string;
}

function collectIntegration(value: string, previous: string[] = []): string[] {
	return [...previous, value];
}

export function registerChatCommand(program: Command): void {
	program
		.command("chat")
		.description(
			"Chat with connected integrations using AI and tools (Ink TUI with follow-ups). With no subcommand, `toby` opens chat; from the root command use `toby -p \"…\"` (maps to `--prompt`) for an initial message. Inside `toby chat`, `-p` selects a persona. Pass a chat integration as the first word, or use --integration (repeatable). With no selection, all connected chat integrations are used. Use --no-tui for one-shot console output. Use --debug to print local skills and preflight skill selection.",
		)
		.argument(
			"[words...]",
			"Optional with `toby chat`: first word may be an integration name (gmail, todoist, slack, azuread, jira); remaining words are the prompt. If the first word is not an integration, the full text is the prompt and all connected chat integrations are used. Prefer `toby -p \"…\"` or `--prompt` for an initial message when omitting the `chat` subcommand.",
		)
		.option("-p, --persona <name>", "Optional persona to shape behavior")
		.option(
			"--prompt <text>",
			"Submit this message when the chat session opens (use `toby -p \"…\"` from the root command)",
		)
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
		.option(
			"--debug",
			"Show local skill catalog and preflight skill selection (meta lines in TUI; dim lines in --no-tui)",
			false,
		)
		.option(
			"--record <file>",
			"Record model responses to a JSON file for token-free replay (bare names go under ~/.toby/recordings/)",
		)
		.option(
			"--replay <file>",
			"Replay model responses from a recorded JSON file (no AI tokens; tools still run live)",
		)
		.action(
			async (words: string[] | undefined, options: ChatCommandOptions) => {
				try {
					const positional = Array.isArray(words) ? words : [];
					const flagIntegrations = options.integration ?? [];
					const { explicitNames, prompt: positionalPrompt } =
						parseChatCliInput(positional, flagIntegrations);
					const prompt = options.prompt?.trim() || positionalPrompt;

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

					if (options.record && options.replay) {
						console.error(
							chalk.red("Cannot use --record and --replay together."),
						);
						process.exitCode = 1;
						return;
					}

					try {
						if (options.record) {
							beginRecording(options.record, {
								provider: persona.ai.provider,
								model: persona.ai.model,
							});
							console.log(
								chalk.dim(
									`Recording model responses to ${getRecordingFilePath() ?? options.record}`,
								),
							);
						} else if (options.replay) {
							beginReplay(options.replay);
							console.log(
								chalk.dim(
									`Replaying model responses from ${options.replay} (tools still run live)`,
								),
							);
						}

						const dryRun = Boolean(options.dryRun);
						const debug = Boolean(options.debug);
						if (options.noTui) {
							if (!prompt) {
								console.error(
									chalk.red(
										'With --no-tui, pass a prompt with --prompt or positional words (e.g. toby chat --no-tui --prompt "summarize unread" or toby chat gmail --no-tui "archive promos").',
									),
								);
								process.exitCode = 1;
								return;
							}

							await runConsoleChatTurn({
								modules,
								prompt,
								persona,
								dryRun,
								debug,
							});
							return;
						}

						await runChatSessionInk({
							modules,
							persona,
							dryRun,
							debug,
							initialUserPrompt: prompt,
						});
					} finally {
						if (options.record) {
							flushRecording();
							const savedPath = getRecordingFilePath();
							if (savedPath) {
								console.log(chalk.green(`Recording saved to ${savedPath}`));
							}
						}
					}
				} catch (error) {
					console.error(
						chalk.red(error instanceof Error ? error.message : String(error)),
					);
					process.exitCode = 1;
				}
			},
		);
}

function formatConsoleScopeLabel(
	modules: readonly IntegrationModule[],
): string {
	if (modules.length === 0) {
		return "(none)";
	}
	return modules.map((m) => m.displayName).join(" + ");
}

async function runConsoleChatTurn(params: {
	readonly modules: readonly IntegrationModule[];
	readonly prompt: string;
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly debug: boolean;
}): Promise<void> {
	const { modules, prompt, persona, dryRun, debug } = params;
	const names = modules.map((m) => m.name).join(", ");

	console.log(chalk.cyan(`Chat (${names}) — persona "${persona.name}"…`));
	console.log(chalk.dim(`  AI: ${formatPersonaAiLabel(persona)}`));
	if (persona.instructions) {
		console.log(chalk.dim(`  Instructions: ${persona.instructions}`));
	}
	if (dryRun) {
		console.log(chalk.yellow("  (dry run - changes will not be applied)"));
	}
	console.log(chalk.dim(`  Goal: ${prompt}`));
	console.log();

	const skills = loadLocalSkills();
	const { content, spec } = await wrapUserPromptWithPretreatment({
		priorMessages: null,
		rawUserText: prompt,
		integrationLabels: formatConsoleScopeLabel(modules),
		isFirstTurn: true,
		persona,
		skillsCatalog: skills,
	});

	if (debug) {
		console.log(chalk.dim("── Skill debug ──"));
		for (const ln of getSkillDebugTextLines({
			available: skills,
			priorMessages: null,
			rawUserText: prompt,
			isFirstTurn: true,
			spec,
		})) {
			console.log(chalk.dim(ln));
		}
		console.log();
	}

	let messages = await prepareChatSessionMessages(modules, persona, content);
	messages = injectSkillBodiesIntoFirstSystemMessage(
		messages,
		spec?.relevantSkills ?? [],
		skills,
	);
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
		return resolveDefaultPersona();
	}

	const persona = resolvePersona(personaName);
	if (persona) {
		return persona;
	}

	console.error(
		chalk.red(`Persona "${personaName}" not found. Available personas:`),
	);
	for (const p of listPersonas()) {
		console.error(chalk.dim(`  - ${p.name} (${formatPersonaAiLabel(p)})`));
	}

	return null;
}
