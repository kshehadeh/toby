import process from "node:process";
import { Command } from "commander";
import packageJson from "../package.json";
import { registerChatCommand } from "./commands/chat";
import { registerConfigCommand } from "./commands/configure";
import { registerConnectCommand } from "./commands/connect";
import { registerDisconnectCommand } from "./commands/disconnect";
import { registerOrganizeCommand } from "./commands/organize";
import { registerSessionsCommand } from "./commands/sessions";
import { registerSkillsCommand } from "./commands/skills";
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
registerConfigCommand(program);
registerSessionsCommand(program);
registerSkillsCommand(program);
registerStatusCommand(program);
registerSummarizeCommand(program);
registerOrganizeCommand(program);
registerUpgradeCommand(program);
registerChatCommand(program);

const rawArgs = process.argv.slice(2);
const subcommandNames = new Set(program.commands.map((c) => c.name()));
const first = rawArgs[0];
const isRootOption =
	first === "--help" ||
	first === "-h" ||
	first === "--version" ||
	first === "-V";
const adjustedArgs =
	!first || (!subcommandNames.has(first) && !isRootOption)
		? ["chat", ...rawArgs]
		: rawArgs;

program.parse(adjustedArgs, { from: "user" });

function resolveCliVersion(): string {
	const envVersion = process.env.TOBY_VERSION?.trim();
	if (envVersion) {
		return envVersion;
	}

	const packageVersion =
		typeof packageJson.version === "string" ? packageJson.version.trim() : "";
	if (packageVersion) {
		return packageVersion;
	}

	return "0.1.0";
}
