import type { Command } from "commander";
import { runSkillsUI } from "../ui/skills/App";

export function registerSkillsCommand(program: Command): void {
	program
		.command("skills")
		.description("View, edit, and delete local skills")
		.action(() => {
			runSkillsUI();
		});
}
