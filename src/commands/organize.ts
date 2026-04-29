import chalk from "chalk";
import type { Command } from "commander";
import type { Persona } from "../config/index";
import {
	getIntegrationModule,
	getModulesWithCapability,
} from "../integrations/index";
import { listPersonas, resolvePersona } from "../personas/index";
import { parseWatchInterval, runWithWatch } from "./watch";

interface OrganizeOptions {
	persona?: string;
	maxResults: string;
	dryRun?: boolean;
	watch?: string;
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

export function registerOrganizeCommand(program: Command): void {
	program
		.command("organize <integration>")
		.description("Organize an integration's relevant data")
		.option("-p, --persona <name>", "Optional persona to shape organization")
		.option(
			"-w, --watch <interval>",
			'Repeat organize on a schedule (e.g. "every hour", "30m")',
		)
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
				const organizer = module.organize;
				if (!organizer) {
					console.error(
						chalk.red(
							`Organize is declared for "${module.name}" but no runner is implemented yet.`,
						),
					);
					process.exitCode = 1;
					return;
				}

				const maxResults = Number.parseInt(options.maxResults, 10);
				const runOnce = async () => {
					await organizer({
						maxResults,
						dryRun: Boolean(options.dryRun),
						personaForModel: persona,
					});
				};

				if (!options.watch) {
					await runOnce();
					return;
				}

				const intervalMs = parseWatchInterval(options.watch);
				console.log(
					chalk.cyan(
						`Watching ${module.displayName} organize every ${intervalMs}ms...`,
					),
				);
				console.log(chalk.dim("  Press Ctrl+C to stop."));
				console.log();

				await runWithWatch({
					label: `${module.name}:organize`,
					intervalMs,
					runOnce,
				});
				return;
			} catch (error) {
				console.error(
					chalk.red(error instanceof Error ? error.message : String(error)),
				);
				process.exitCode = 1;
			}
		});
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
