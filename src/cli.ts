import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerChatCommand } from "./commands/chat";
import { registerConfigureCommand } from "./commands/configure";
import { registerConnectCommand } from "./commands/connect";
import { registerDisconnectCommand } from "./commands/disconnect";
import { registerOrganizeCommand } from "./commands/organize";
import { registerSessionsCommand } from "./commands/sessions";
import { registerStatusCommand } from "./commands/status";
import { registerSummarizeCommand } from "./commands/summarize";
import { registerUpgradeCommand } from "./commands/upgrade";
import { getIntegrationModules } from "./integrations/index";

const program = new Command();
const cliVersion = resolveCliVersion();

program
	.name("toby")
	.description(
		"CLI-based tool for managing your life — email, calendar, todos, and more",
	)
	.version(cliVersion);

registerConnectCommand(program);
registerDisconnectCommand(program);
for (const mod of getIntegrationModules()) {
	mod.registerCommands?.(program);
}
registerConfigureCommand(program);
registerSessionsCommand(program);
registerStatusCommand(program);
registerSummarizeCommand(program);
registerOrganizeCommand(program);
registerUpgradeCommand(program);
registerChatCommand(program);

program.parse();

function resolveCliVersion(): string {
	const envVersion = process.env.npm_package_version?.trim();
	if (envVersion) {
		return envVersion;
	}

	const cliDir = path.dirname(fileURLToPath(import.meta.url));
	const packageJsonPath = path.resolve(cliDir, "../package.json");
	try {
		const raw = readFileSync(packageJsonPath, "utf8");
		const parsed = JSON.parse(raw) as { version?: unknown };
		if (
			typeof parsed.version === "string" &&
			parsed.version.trim().length > 0
		) {
			return parsed.version.trim();
		}
	} catch {
		// Fall through to default when package metadata is unavailable.
	}

	return "0.1.0";
}
