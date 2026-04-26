import chalk from "chalk";
import type { Command } from "commander";
import { getIntegration, getIntegrations } from "../integrations/index";
import type { IntegrationHealth } from "../integrations/types";

interface IntegrationStatusOptions {
	integration?: string;
}

export function registerStatusCommand(program: Command): void {
	const status = program.command("status").description("Check system status");

	status
		.command("integration")
		.description("Test an integration connection and permissions")
		.option(
			"-i, --integration <name>",
			"Integration name to test (e.g. gmail). If omitted, all integrations are tested.",
		)
		.action(async (options: IntegrationStatusOptions) => {
			if (options.integration) {
				const integration = getIntegration(options.integration);
				if (!integration) {
					console.error(
						chalk.red(`Unknown integration: ${options.integration}`),
					);
					process.exitCode = 1;
					return;
				}

				const ok = await runIntegrationTest(integration);
				if (!ok) {
					process.exitCode = 1;
				}
				return;
			}

			const integrations = getIntegrations();
			if (integrations.length === 0) {
				console.log(chalk.yellow("No integrations are configured."));
				return;
			}

			console.log(chalk.cyan("Testing all integrations..."));
			let hasFailures = false;
			for (const integration of integrations) {
				const ok = await runIntegrationTest(integration);
				if (!ok) {
					hasFailures = true;
				}
			}

			if (hasFailures) {
				process.exitCode = 1;
			}
		});
}

async function runIntegrationTest(integration: {
	displayName: string;
	testConnection: () => Promise<IntegrationHealth>;
}): Promise<boolean> {
	console.log(chalk.cyan(`Testing ${integration.displayName} integration...`));
	const result = await integration.testConnection();

	if (result.tools && result.tools.length > 0) {
		for (const toolCheck of result.tools) {
			const prefix = toolCheck.ok ? chalk.green("  ✓") : chalk.red("  ✗");
			console.log(`${prefix} ${toolCheck.tool}: ${toolCheck.details}`);
		}
	}

	if (result.ok) {
		console.log(chalk.green(`✓ ${integration.displayName}: ${result.details}`));
		return true;
	}

	console.log(chalk.red(`✗ ${integration.displayName}: ${result.details}`));
	return false;
}
