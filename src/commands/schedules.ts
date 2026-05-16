import type { Command } from "commander";
import { runSchedulesUI } from "../ui/schedules/App";

export function registerSchedulesCommand(program: Command): void {
	program
		.command("schedules")
		.description("View, create, edit, and delete schedules")
		.action(() => {
			runSchedulesUI();
		});
}
