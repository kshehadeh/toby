import process from "node:process";
import { getIntegrationModules } from "@toby/core/integrations/index";
import { getTobyVersion } from "@toby/core/version";
import { Command } from "commander";
import { registerChatCommand } from "./commands/chat";
import { registerConfigCommand } from "./commands/configure";
import { registerConnectCommand } from "./commands/connect";
import { registerDaemonCommand } from "./commands/daemon";
import { registerDisconnectCommand } from "./commands/disconnect";
import { registerInternalCommands } from "./commands/internal-handoff";
import { registerListenCommand } from "./commands/listen";
import { registerPluginsCommand } from "./commands/plugins";
import { registerSchedulesCommand } from "./commands/schedules";
import { registerSessionsCommand } from "./commands/sessions";
import { registerSkillsCommand } from "./commands/skills";
import { registerStatusCommand } from "./commands/status";
import { registerUpgradeCommand } from "./commands/upgrade";
import { registerWhisperCommand } from "./commands/whisper";
import { setHuggingFaceCacheDir } from "@toby/core/huggingface/envconfig";

const program = new Command();
const cliVersion = getTobyVersion();

setHuggingFaceCacheDir();

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
registerWhisperCommand(program);
registerListenCommand(program);
registerPluginsCommand(program);
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
