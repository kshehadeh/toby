import { getIntegration, getIntegrations } from "@toby/core/integrations/index";
import type { SlashCommand } from "./types";

export const connectSlashCommand: SlashCommand = {
	command: "/connect",
	description: "Connect an integration, or list all supported integrations.",
	helpText:
		"Connect an integration by name (e.g. /connect gmail). Run without arguments to list available integrations.",
	async run(runtime, rawArgs) {
		const name = rawArgs?.trim();

		if (!name) {
			const integrations = getIntegrations();
			if (integrations.length === 0) {
				runtime.addMetaLine("No integrations available.");
				return;
			}
			const lines = integrations.map(async (i) => {
				const connected = await i.isConnected();
				const status = connected ? "connected" : "not connected";
				return `  ${i.displayName.padEnd(12)} ${status}  ${i.description}`;
			});
			for (const line of await Promise.all(lines)) {
				runtime.addMetaLine(line);
			}
			runtime.addMetaLine("Run /connect <name> to connect an integration.");
			return;
		}

		const integration = getIntegration(name);
		if (!integration) {
			runtime.addMetaLine(`Unknown integration: ${name}`);
			runtime.addMetaLine("Run /connect to see available integrations.");
			return;
		}

		const alreadyConnected = await integration.isConnected();
		if (alreadyConnected) {
			runtime.addMetaLine(`${integration.displayName} is already connected.`);
			return;
		}

		try {
			await integration.connect();
			runtime.addMetaLine(`${integration.displayName} connected successfully.`);
		} catch (e) {
			runtime.addMetaLine(
				`Failed to connect ${integration.displayName}: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	},
};
