import type { Command } from "commander";
import { runConfigureUI } from "../ui/configure/App";
import { createConfigureSession } from "../ui/configure/session";

export function registerSchedulesCommand(program: Command): void {
	program
		.command("schedules")
		.description("View, create, edit, and delete schedules")
		.action(() => {
			const session = createConfigureSession();
			runConfigureUI(
				session.initialTree,
				session.initialValues,
				session.onSave,
				session.refreshTree,
				session.callbacks,
				{ initialPath: ["root", "schedules"] },
			);
		});
}
