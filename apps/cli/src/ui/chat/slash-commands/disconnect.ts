import { getIntegration, getIntegrations } from "@toby/core/integrations/index";
import type { SlashCommand } from "./types";

export const disconnectSlashCommand: SlashCommand = {
	command: "/disconnect",
	description: "Disconnect an integration, or list all connected integrations.",
	helpText:
		"Disconnect an integration by name (e.g. /disconnect gmail). Run without arguments to list connected integrations.",
	async run(runtime, rawArgs) {
		const name = rawArgs?.trim();

		if (!name) {
			const integrations = getIntegrations();
			const connectedNames: string[] = [];
			for (const i of integrations) {
				if (await i.isConnected()) {
					connectedNames.push(i.displayName);
				}
			}
			if (connectedNames.length === 0) {
				runtime.addMetaLine("No integrations are currently connected.");
			} else {
				for (const n of connectedNames) {
					runtime.addMetaLine(`  ${n}  connected`);
				}
			}
			runtime.addMetaLine(
				"Run /disconnect <name> to disconnect an integration.",
			);
			return;
		}

		const integration = getIntegration(name);
		if (!integration) {
			runtime.addNoticeLine(`Unknown integration: ${name}`, "error");
			runtime.addNoticeLine(
				"Run /disconnect to see connected integrations.",
				"info",
			);
			return;
		}

		const connected = await integration.isConnected();
		if (!connected) {
			runtime.addNoticeLine(
				`${integration.displayName} is not connected.`,
				"info",
			);
			return;
		}

		try {
			await integration.disconnect();
			runtime.addNoticeLine(
				`${integration.displayName} disconnected successfully.`,
				"success",
			);
		} catch (e) {
			runtime.addNoticeLine(
				`Failed to disconnect ${integration.displayName}: ${e instanceof Error ? e.message : String(e)}`,
				"error",
			);
		}
	},
};
