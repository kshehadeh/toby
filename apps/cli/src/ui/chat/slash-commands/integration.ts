import { getDefaultProvider } from "@toby/core/config/index";
import {
	getIntegrationModules,
	getModulesForCategory,
} from "@toby/core/integrations/index";
import {
	ALL_PROVIDER_CATEGORIES,
	PROVIDER_CATEGORY_LABELS,
	type ProviderCategory,
} from "@toby/core/integrations/types";
import type { SlashCommand } from "./types";

export const integrationSlashCommand: SlashCommand = {
	command: "/integration",
	description: "Show integration status by category, or open the picker.",
	helpText:
		"Show all integrations grouped by category with connection status. Pass 'pick' to open the integration picker.",
	async run(runtime, rawArgs) {
		if (rawArgs?.trim() === "pick") {
			if (runtime.chatIntegrationsCount === 0) {
				runtime.addMetaLine("No chat integrations available.");
				return;
			}
			runtime.openIntegrationPicker();
			return;
		}

		const modules = getIntegrationModules();
		if (modules.length === 0) {
			runtime.addMetaLine("No integrations available.");
			return;
		}

		const connectionResults = await Promise.all(
			modules.map(async (m) => ({
				module: m,
				connected: await m.isConnected(),
			})),
		);

		const connectedByModule = new Map(
			connectionResults.map((r) => [r.module.name, r.connected]),
		);

		const categorized = new Set<string>();

		for (const cat of ALL_PROVIDER_CATEGORIES) {
			const catModules = getModulesForCategory(cat);
			if (catModules.length === 0) continue;

			for (const m of catModules) categorized.add(m.name);

			const defaultName = getDefaultProvider(cat);

			runtime.addMetaLine("");
			runtime.addMetaLine(`  \x1b[1m${PROVIDER_CATEGORY_LABELS[cat]}\x1b[22m`);

			for (const m of catModules) {
				const ok = connectedByModule.get(m.name);
				const isDefault = m.name === defaultName;
				const glyph = ok ? "✔︎" : "✗";
				const label = ok ? "connected" : "disconnected";
				const defaultTag = isDefault ? " ★ default" : "";
				runtime.addMetaLine(
					`    ${glyph} ${m.displayName}  ${label}${defaultTag}`,
				);
			}
		}

		const uncategorized = modules.filter((m) => !categorized.has(m.name));
		if (uncategorized.length > 0) {
			runtime.addMetaLine("");
			runtime.addMetaLine("  \x1b[1mOther\x1b[22m");

			for (const m of uncategorized) {
				const ok = connectedByModule.get(m.name);
				const glyph = ok ? "✔︎" : "✗";
				const label = ok ? "connected" : "disconnected";
				const wouldBeCategories = m.providerCategories
					? ` (would be: ${m.providerCategories.map((c) => PROVIDER_CATEGORY_LABELS[c]).join(", ")})`
					: "";
				runtime.addMetaLine(
					`    ${glyph} ${m.displayName}  ${label}${wouldBeCategories}`,
				);
			}
		}

		runtime.addMetaLine("");
		const connectedCount = connectionResults.filter((r) => r.connected).length;
		const disconnectedCount = connectionResults.length - connectedCount;
		runtime.addMetaLine(
			`  ${connectedCount} connected · ${disconnectedCount} disconnected`,
		);
		runtime.addMetaLine("  ★ = default provider for that category");
		runtime.addMetaLine(
			"  Run /integration pick to choose active integrations.",
		);
		runtime.addMetaLine(
			"  Run /connect <name> or /disconnect <name> to change connection.",
		);
	},
};
