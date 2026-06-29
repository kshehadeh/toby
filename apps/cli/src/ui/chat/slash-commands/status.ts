import path from "node:path";
import {
	getConfigPath,
	getCredentialsPath,
	getDaemonLogPath,
	getHelpersDir,
	getLogPath,
	getUpgradeLogPath,
	getWebConfig,
	resolveTobyDir,
} from "@toby/core/config/index";
import { pluginDisplayPath } from "@toby/core/integrations/plugins/protocol";
import {
	collectPluginListEntries,
	resolvePluginSearchDirectories,
} from "@toby/core/integrations/plugins/registry";
import { getTobyExecPath } from "@toby/core/toby-spawn";
import { getTobyVersion } from "@toby/core/version";
import { isDaemonRunning } from "../../../schedules/daemon-status";
import { resolveTobyAppPath } from "../toby-app-launcher";
import type { SlashCommand } from "./types";

function formatPluginEntryLine(entry: {
	readonly name: string;
	readonly pluginPath: string;
	readonly state: string;
	readonly connected?: boolean;
}): string {
	const status =
		entry.state === "valid"
			? entry.connected
				? "connected"
				: "disconnected"
			: entry.state;
	return `  **${entry.name}** · ${status}\n    ${entry.pluginPath}`;
}

export function buildStatusReportLines(): string[] {
	const lines: string[] = [];

	lines.push("## Version");
	lines.push(`  v${getTobyVersion()}`);
	lines.push("");

	lines.push("## CLI binary");
	lines.push(`  ${getTobyExecPath()}`);
	lines.push("");

	lines.push("## Native app");
	const app = resolveTobyAppPath();
	if (app) {
		lines.push(`  ${app.path} (${app.kind})`);
	} else {
		lines.push("  Not found");
	}
	lines.push("");

	lines.push("## Server");
	const daemon = isDaemonRunning();
	if (daemon.running) {
		lines.push(`  Running · PID ${daemon.pid}`);
		if (daemon.intervalSeconds !== null) {
			lines.push(`  Interval: ${daemon.intervalSeconds}s`);
		}
	} else {
		lines.push("  Stopped");
	}
	lines.push("");

	lines.push("## HTTP API");
	const web = getWebConfig();
	lines.push(`  ${web.enabled ? "Enabled" : "Disabled"} · port ${web.port}`);
	lines.push("");

	lines.push("## Plugin directories");
	const pluginDirs = resolvePluginSearchDirectories();
	if (pluginDirs.length === 0) {
		lines.push("  (none)");
	} else {
		for (const dir of pluginDirs) {
			lines.push(`  ${dir}`);
		}
	}
	lines.push("");

	lines.push("## Discovered plugins");
	const pluginEntries = collectPluginListEntries();
	if (pluginEntries.length === 0) {
		lines.push("  (none)");
	} else {
		for (const entry of pluginEntries) {
			lines.push(
				formatPluginEntryLine({
					name: entry.name,
					pluginPath: pluginDisplayPath(entry.discovered),
					state: entry.state,
					connected: entry.connected,
				}),
			);
		}
	}
	lines.push("");

	lines.push("## Helpers");
	lines.push(`  ${getHelpersDir()}`);
	lines.push("");

	lines.push("## Data directories");
	const tobyDir = resolveTobyDir();
	lines.push(`  Toby dir:    ${tobyDir}`);
	lines.push(`  Config:      ${getConfigPath()}`);
	lines.push(`  Credentials: ${getCredentialsPath()}`);
	lines.push(`  Log:         ${getLogPath()}`);
	lines.push(`  Daemon log:  ${getDaemonLogPath()}`);
	lines.push(`  Upgrade log: ${getUpgradeLogPath()}`);
	lines.push(`  Staging:     ${path.join(tobyDir, "staging")}`);
	lines.push("");

	return lines;
}

export const statusSlashCommand: SlashCommand = {
	command: "/status",
	description: "Show the locations and status of all Toby binaries.",
	helpText:
		"Display paths for the CLI binary, native app, server, plugins, helpers, and data directories in a viewer modal.",
	run(runtime) {
		const lines = buildStatusReportLines();
		for (const line of lines) {
			runtime.addMetaLine(line);
		}
		runtime.openTextViewer("Status", lines, { lineTone: "markdown" });
	},
};
