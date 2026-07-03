import type { Command } from "commander";
import { runAppLaunchCommand } from "./app";

export function registerSchedulesCommand(program: Command): void {
	program
		.command("schedules")
		.description("Open native app schedules")
		.action(() => {
			runAppLaunchCommand("Schedules");
		});
}
