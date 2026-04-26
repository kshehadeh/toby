import type { Command } from "commander";
import { runConfigureUI } from "../ui/configure/App";
import { createConfigureSession } from "../ui/configure/session";

export function registerConfigureCommand(program: Command): void {
	program
		.command("configure")
		.description("Configure Toby settings (integrations, credentials, etc.)")
		.action(() => {
			const session = createConfigureSession();

			runConfigureUI(
				session.initialTree,
				session.initialValues,
				session.onSave,
				session.refreshTree,
				session.callbacks,
			);
		});
}
