import type { Command } from "commander";
import { runAppLaunchCommand } from "./app";

export function registerSkillsCommand(program: Command): void {
	program
		.command("skills")
		.description("Open native app skills")
		.action(() => {
			runAppLaunchCommand("Skills");
		});
}
