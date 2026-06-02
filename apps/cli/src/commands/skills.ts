import type { Command } from "commander";
import { runConfigureUI } from "../ui/configure/App";
import { createConfigureSession } from "../ui/configure/session";

export function registerSkillsCommand(program: Command): void {
	program
		.command("skills")
		.description("View, edit, and delete local skills")
		.action(() => {
			const session = createConfigureSession();
			runConfigureUI(
				session.initialTree,
				session.initialValues,
				session.onSave,
				session.refreshTree,
				session.callbacks,
				{ initialPath: ["root", "skills"] },
			);
		});
}
