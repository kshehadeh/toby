import { Command } from "commander";
import { registerConfigureCommand } from "./commands/configure";
import { registerConnectCommand } from "./commands/connect";
import { registerDisconnectCommand } from "./commands/disconnect";
import { registerOrganizeCommand } from "./commands/organize";
import { registerStatusCommand } from "./commands/status";
import { registerSummarizeCommand } from "./commands/summarize";
import { getIntegrationModules } from "./integrations/index";

const program = new Command();

program
	.name("toby")
	.description(
		"CLI-based tool for managing your life — email, calendar, todos, and more",
	)
	.version("0.1.0");

registerConnectCommand(program);
registerDisconnectCommand(program);
for (const mod of getIntegrationModules()) {
	mod.registerCommands?.(program);
}
registerConfigureCommand(program);
registerStatusCommand(program);
registerSummarizeCommand(program);
registerOrganizeCommand(program);

program.parse();
