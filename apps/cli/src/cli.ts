import process from "node:process";
import { getIntegrationModules } from "@toby/core/integrations/index";
import { getTobyVersion } from "@toby/core/version";
import { Command } from "commander";
import { registerAppCommand, runAppLaunchCommand } from "./commands/app";
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

const program = new Command();
const cliVersion = getTobyVersion();

program
	.name("toby")
	.description(
		"CLI maintenance commands for Toby. Run without a subcommand to open the native Toby app.",
	)
	.version(cliVersion)
	.action(() => {
		runAppLaunchCommand();
	});

registerAppCommand(program);
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
registerPluginsCommand(program);
registerInternalCommands(program);

program.parse(process.argv.slice(2), { from: "user" });
