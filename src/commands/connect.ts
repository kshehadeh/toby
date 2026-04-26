import chalk from "chalk";
import type { Command } from "commander";
import { getIntegration, getIntegrations } from "../integrations/index";

export function registerConnectCommand(program: Command): void {
	program
		.command("connect [integration]")
		.description("Connect an integration, or list all supported integrations")
		.action(async (integration?: string) => {
			if (!integration) {
				await listIntegrations();
				return;
			}
			await connectIntegration(integration);
		});
}

async function listIntegrations(): Promise<void> {
	const integrations = getIntegrations();
	console.log(chalk.bold("\nSupported integrations:\n"));
	for (const i of integrations) {
		const connected = await i.isConnected();
		const status = connected
			? chalk.green("connected")
			: chalk.dim("not connected");
		console.log(`  ${chalk.bold(i.displayName.padEnd(12))} ${status}`);
		console.log(`  ${chalk.dim(i.description)}\n`);
	}
	console.log(
		chalk.dim(
			`Run ${chalk.white("toby connect <name>")} to connect an integration.`,
		),
	);
}

async function connectIntegration(name: string): Promise<void> {
	const integration = getIntegration(name);
	if (!integration) {
		console.log(chalk.red(`Unknown integration: ${name}`));
		console.log(
			chalk.dim(
				`Run ${chalk.white("toby connect")} to see available integrations.`,
			),
		);
		return;
	}
	await integration.connect();
}
