import { getDefaultProvider } from "@toby/core/config/index";
import {
	getIntegration,
	getIntegrationModules,
	getModulesForCategory,
} from "@toby/core/integrations/index";
import {
	ALL_PROVIDER_CATEGORIES,
	type IntegrationModule,
	PROVIDER_CATEGORY_LABELS,
} from "@toby/core/integrations/types";
import {
	countIntegrationConnectionStatuses,
	runConnectionProbes,
} from "../connection-probe";
import type { SlashCommand } from "./types";

function formatCapabilities(
	capabilities: readonly string[] | undefined,
): string {
	if (!capabilities || capabilities.length === 0) {
		return "";
	}
	return ` · *${capabilities.join(", ")}*`;
}

function formatIntegrationLine(
	module: IntegrationModule,
	connected: boolean,
	healthy: boolean,
	timedOut: boolean,
	isDefault: boolean,
): string {
	const glyph = connected ? "✔︎" : "✗";
	const status = !connected
		? "disconnected"
		: healthy
			? "connected"
			: timedOut
				? "degraded"
				: "degraded";
	const defaultTag = isDefault ? " · *★ default*" : "";
	const caps = formatCapabilities(module.capabilities);
	return `${glyph} **${module.displayName}** · ${status}${defaultTag}${caps}`;
}

export async function buildConnectionsReportLines(options?: {
	readonly onProgress?: (text: string) => void | Promise<void>;
}): Promise<string[]> {
	const modules = getIntegrationModules();
	if (modules.length === 0) {
		return [
			"## Integrations",
			"  *(none available)*",
			"",
			"Install plugins with `toby plugins install <path>`.",
		];
	}

	const probeResults = await runConnectionProbes(modules, {
		onProgress: async (event) => {
			if (event.type === "start") {
				await options?.onProgress?.(
					`Checking ${event.module.displayName} connection…`,
				);
			}
		},
	});
	const connectedByModule = new Map(
		probeResults.map((r) => [r.name, r.connected]),
	);
	const healthyByModule = new Map(probeResults.map((r) => [r.name, r.healthy]));
	const timedOutByModule = new Map(
		probeResults.map((r) => [r.name, r.timedOut]),
	);

	const lines: string[] = [];
	lines.push("## Integrations");
	lines.push("");

	const categorized = new Set<string>();

	for (const cat of ALL_PROVIDER_CATEGORIES) {
		const catModules = getModulesForCategory(cat);
		if (catModules.length === 0) {
			continue;
		}

		for (const m of catModules) {
			categorized.add(m.name);
		}

		const defaultName = getDefaultProvider(cat);
		lines.push(`## ${PROVIDER_CATEGORY_LABELS[cat]}`);

		for (const m of catModules) {
			const connected = connectedByModule.get(m.name) ?? false;
			const healthy = healthyByModule.get(m.name) ?? false;
			const timedOut = timedOutByModule.get(m.name) ?? false;
			lines.push(
				formatIntegrationLine(
					m,
					connected,
					healthy,
					timedOut,
					m.name === defaultName,
				),
			);
			if (m.description) {
				lines.push(`    *${m.description}*`);
			}
		}
		lines.push("");
	}

	const uncategorized = modules.filter((m) => !categorized.has(m.name));
	if (uncategorized.length > 0) {
		lines.push("## Other");
		for (const m of uncategorized) {
			const connected = connectedByModule.get(m.name) ?? false;
			const healthy = healthyByModule.get(m.name) ?? false;
			const timedOut = timedOutByModule.get(m.name) ?? false;
			lines.push(formatIntegrationLine(m, connected, healthy, timedOut, false));
			if (m.description) {
				lines.push(`    *${m.description}*`);
			}
			if (m.providerCategories && m.providerCategories.length > 0) {
				const labels = m.providerCategories
					.map((c) => PROVIDER_CATEGORY_LABELS[c])
					.join(", ");
				lines.push(`    *Categories: ${labels}*`);
			}
		}
		lines.push("");
	}

	const { connected: connectedCount, disconnected: disconnectedCount } =
		countIntegrationConnectionStatuses(
			modules,
			Object.fromEntries(connectedByModule),
		);

	lines.push(
		`**${connectedCount}** connected · **${disconnectedCount}** disconnected`,
	);
	lines.push("★ = default provider for that category");
	lines.push("Run `/connect <name>` to connect an integration.");
	lines.push("Run `/disconnect <name>` to disconnect.");
	return lines;
}

export const connectSlashCommand: SlashCommand = {
	command: "/connect",
	description: "Connect an integration, or list all supported integrations.",
	helpText:
		"Connect an integration by name (e.g. /connect email). Run without arguments to open the connections viewer.",
	async run(runtime, rawArgs) {
		const name = rawArgs?.trim();

		if (!name) {
			const modules = getIntegrationModules();
			if (modules.length > 0) {
				await runtime.updateProgressNotice(
					`Checking ${modules.length} integration connection${
						modules.length === 1 ? "" : "s"
					}…`,
				);
			}
			const lines = await buildConnectionsReportLines({
				onProgress: (text) => runtime.updateProgressNotice(text),
			});
			for (const line of lines) {
				runtime.addMetaLine(line);
			}
			if (modules.length > 0) {
				await runtime.updateProgressNotice("Connections ready.", "success");
			}
			runtime.openTextViewer("Connections", lines, { lineTone: "markdown" });
			return;
		}

		const integration = getIntegration(name);
		if (!integration) {
			runtime.addNoticeLine(`Unknown integration: ${name}`, "error");
			runtime.addNoticeLine(
				"Run /connect to see available integrations.",
				"info",
			);
			return;
		}

		const alreadyConnected = await integration.isConnected();
		if (alreadyConnected) {
			runtime.addNoticeLine(
				`${integration.displayName} is already connected.`,
				"info",
			);
			return;
		}

		try {
			await integration.connect();
			runtime.addNoticeLine(
				`${integration.displayName} connected successfully.`,
				"success",
			);
		} catch (e) {
			runtime.addNoticeLine(
				`Failed to connect ${integration.displayName}: ${e instanceof Error ? e.message : String(e)}`,
				"error",
			);
		}
	},
};
