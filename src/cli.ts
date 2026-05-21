import process from "node:process";
import { Command } from "commander";
import { registerChatCommand } from "./commands/chat";
import { registerConfigCommand } from "./commands/configure";
import { registerConnectCommand } from "./commands/connect";
import { registerDaemonCommand } from "./commands/daemon";
import { registerDisconnectCommand } from "./commands/disconnect";
import { registerInternalCommands } from "./commands/internal-handoff";
import { registerListenCommand } from "./commands/listen";
import { registerSchedulesCommand } from "./commands/schedules";
import { registerSessionsCommand } from "./commands/sessions";
import { registerSkillsCommand } from "./commands/skills";
import { registerStatusCommand } from "./commands/status";
import { registerUpgradeCommand } from "./commands/upgrade";
import { getIntegrationModules } from "./integrations/index";
import { getTobyVersion } from "./version";

const program = new Command();
const cliVersion = getTobyVersion();

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
registerDaemonCommand(program);
registerSchedulesCommand(program);
registerSessionsCommand(program);
registerSkillsCommand(program);
registerStatusCommand(program);
registerUpgradeCommand(program);
registerListenCommand(program);
registerInternalCommands(program);
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
