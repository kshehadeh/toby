import { generateText } from "ai";
import chalk from "chalk";
import type { Command } from "commander";
import { createModelForPersona } from "../ai/chat";
import type { Persona } from "../config/index";
import {
	getIntegrationModule,
	getModulesWithCapability,
} from "../integrations/index";
import { listPersonas, resolvePersona } from "../personas/index";

interface SummarizeOptions {
	persona?: string;
	maxResults: string;
}

const DEFAULT_SUMMARY_PERSONA: Persona = {
	name: "default-summary",
	instructions: "",
	ai: {
		provider: "openai",
		model: "gpt-4o-mini",
	},
};

export function registerSummarizeCommand(program: Command): void {
	program
		.command("summarize <integration>")
		.description("Summarize an integration's relevant data")
		.option("-p, --persona <name>", "Optional persona to shape summarization")
		.option(
			"-n, --max-results <number>",
			"Maximum number of items to include for summarization",
			"30",
		)
		.action(async (integrationName: string, options: SummarizeOptions) => {
			try {
				const module = getIntegrationModule(integrationName);
				if (!module) {
					console.error(chalk.red(`Unknown integration: ${integrationName}`));
					process.exitCode = 1;
					return;
				}

				if (!module.capabilities.includes("summarize") || !module.summarize) {
					const supported = getModulesWithCapability("summarize").map(
						(m) => m.name,
					);
					console.error(
						chalk.red(
							`Summarize is not available for "${module.name}". Supported: ${supported.join(", ") || "(none)"}.`,
						),
					);
					process.exitCode = 1;
					return;
				}

				const persona = resolveSummaryPersona(options.persona);
				if (!persona) {
					process.exitCode = 1;
					return;
				}

				const maxResults = Number.parseInt(options.maxResults, 10);
				console.log(
					chalk.cyan(
						`Summarizing ${module.displayName} (up to ${maxResults})...`,
					),
				);
				console.log(
					chalk.dim(`  AI: ${persona.ai.provider}/${persona.ai.model}`),
				);
				if (persona.instructions) {
					console.log(chalk.dim(`  Persona: ${persona.name}`));
				}
				console.log();

				const summaryPersona =
					persona.name === DEFAULT_SUMMARY_PERSONA.name ? undefined : persona;

				const run = await module.summarize({
					maxResults,
					summaryPersona,
					personaForModel: persona,
				});

				if (run.status === "empty") {
					console.log(chalk.green(run.message));
					return;
				}

				const model = createModelForPersona(persona);
				const result = await generateText({
					model,
					messages: run.messages,
				});

				console.log(chalk.bold("Summary\n"));
				console.log(result.text.trim());
			} catch (error) {
				console.error(
					chalk.red(error instanceof Error ? error.message : String(error)),
				);
				process.exitCode = 1;
			}
		});
}

function resolveSummaryPersona(personaName?: string): Persona | null {
	if (!personaName) {
		return DEFAULT_SUMMARY_PERSONA;
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
