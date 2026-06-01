import chalk from "chalk";
import type { Command } from "commander";
import { getIntegration, getIntegrations } from "../integrations/index";

export function registerDisconnectCommand(program: Command): void {
	program
		.command("disconnect [integration]")
		.description(
			"Disconnect an integration, or list all connected integrations",
		)
		.action(async (integration?: string) => {
			if (!integration) {
				await listConnectedIntegrations();
				return;
			}
			await disconnectIntegration(integration);
		});
}

async function listConnectedIntegrations(): Promise<void> {
	const integrations = getIntegrations();
	console.log(chalk.bold("\nConnected integrations:\n"));

	let hasConnected = false;
	for (const integration of integrations) {
		const connected = await integration.isConnected();
		if (!connected) {
			continue;
		}

		hasConnected = true;
		console.log(
			`  ${chalk.bold(integration.displayName)} ${chalk.green("connected")}`,
		);
	}

	if (!hasConnected) {
		console.log(chalk.dim("  No integrations are currently connected."));
	}

	console.log();
	console.log(
		chalk.dim(
			`Run ${chalk.white("toby disconnect <name>")} to disconnect an integration.`,
		),
	);
}

async function disconnectIntegration(name: string): Promise<void> {
	const integration = getIntegration(name);
	if (!integration) {
		console.log(chalk.red(`Unknown integration: ${name}`));
		console.log(
			chalk.dim(
				`Run ${chalk.white("toby disconnect")} to see connected integrations.`,
			),
		);
		process.exitCode = 1;
		return;
	}

	await integration.disconnect();
}
