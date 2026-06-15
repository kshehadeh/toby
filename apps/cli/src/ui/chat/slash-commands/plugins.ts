import {
	type PluginListEntry,
	collectPluginListEntries,
} from "@toby/core/integrations/plugins/list-status";
import { resolvePluginSearchDirectories } from "@toby/core/integrations/plugins/registry";
import type { SlashCommand } from "./types";

function formatCapabilities(
	capabilities: readonly string[] | undefined,
): string {
	if (!capabilities || capabilities.length === 0) {
		return "";
	}
	return ` · ${capabilities.map((cap) => `*${cap}*`).join(", ")}`;
}

function formatPluginLine(entry: PluginListEntry): string {
	if (entry.state === "disabled") {
		return `– **${entry.name}** · disabled`;
	}

	if (entry.state === "invalid") {
		const code = entry.errorCode ? ` *(${entry.errorCode})*` : "";
		return `✗ **${entry.discovered.binaryName}** · invalid${code}`;
	}

	const label = entry.displayName ?? entry.name;
	const connection = entry.connected ? "connected" : "disconnected";
	const glyph = entry.connected ? "✔︎" : "✗";
	const version =
		entry.version && entry.protocolVersion
			? ` · *v${entry.version}* · protocol ${entry.protocolVersion}`
			: "";
	const caps = formatCapabilities(entry.capabilities);
	return `${glyph} **${label}** · ${connection}${version}${caps}`;
}

export function buildPluginsReportLines(): string[] {
	const searchDirs = resolvePluginSearchDirectories();
	const entries = collectPluginListEntries();
	const lines: string[] = [];

	lines.push("## Plugin search paths");
	if (searchDirs.length === 0) {
		lines.push("  (none)");
	} else {
		for (const dir of searchDirs) {
			lines.push(`  ${dir}`);
		}
	}
	lines.push("");
	lines.push("## Plugins");

	if (entries.length === 0) {
		lines.push("  *(none discovered)*");
		lines.push("");
		lines.push("Install plugins with `toby plugins install <path>`.");
		return lines;
	}

	for (const entry of entries) {
		lines.push(formatPluginLine(entry));
		if (entry.state === "valid" && entry.description) {
			lines.push(`    *${entry.description}*`);
		}
		if (entry.state === "invalid" && entry.error) {
			lines.push(`    *${entry.error}*`);
		}
	}

	const valid = entries.filter((e) => e.state === "valid");
	const connectedCount = valid.filter((e) => e.connected).length;
	const disconnectedCount = valid.length - connectedCount;
	const disabledCount = entries.filter((e) => e.state === "disabled").length;
	const invalidCount = entries.filter((e) => e.state === "invalid").length;

	lines.push("");
	lines.push(
		`**${connectedCount}** connected · **${disconnectedCount}** disconnected · **${disabledCount}** disabled · **${invalidCount}** invalid`,
	);
	lines.push("Run `toby plugins install <path>` to add or update plugins.");
	lines.push(
		"Run `/connect <name>` or `/disconnect <name>` to change connection.",
	);
	return lines;
}

export const pluginsSlashCommand: SlashCommand = {
	command: "/plugins",
	description: "List installable plugins and their connection status.",
	helpText:
		"Show discovered plugin binaries under ~/.toby/plugins/ with version, capabilities, and connection status.",
	async run(runtime) {
		const lines = buildPluginsReportLines();
		for (const line of lines) {
			runtime.addMetaLine(line);
		}
		runtime.openTextViewer("Plugins", lines, { lineTone: "markdown" });
	},
};
