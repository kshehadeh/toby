import { clearChatSessions } from "@toby/core/session-store";
import chalk from "chalk";
import type { Command } from "commander";

export function registerSessionsCommand(program: Command): void {
	const sessions = program
		.command("sessions")
		.description("Manage saved chat sessions");

	sessions
		.command("clear")
		.description("Delete all saved chat sessions")
		.action(() => {
			const deleted = clearChatSessions();
			if (deleted === 0) {
				console.log(chalk.yellow("No saved sessions to clear."));
				return;
			}
			const noun = deleted === 1 ? "session" : "sessions";
			console.log(chalk.green(`Cleared ${deleted} ${noun}.`));
		});
}
