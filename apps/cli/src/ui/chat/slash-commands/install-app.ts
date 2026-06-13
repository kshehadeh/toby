import {
	buildTobyAppIfNeeded,
	installTobyAppFromDist,
} from "../toby-app-launcher";
import type { SlashCommand } from "./types";

export const installAppSlashCommand: SlashCommand = {
	command: "/install-app",
	description: "Install the native Toby app to Applications.",
	helpText:
		"Builds Toby.app if needed, then copies it to /Applications (or ~/Applications).",
	async run(runtime) {
		const built = buildTobyAppIfNeeded();
		if (!built.ok) {
			runtime.addNoticeLine(built.message, "error");
			return;
		}
		if (built.message !== "Using existing dist/Toby.app.") {
			runtime.addNoticeLine(built.message, "success");
		}

		const installed = installTobyAppFromDist();
		runtime.addNoticeLine(
			installed.message,
			installed.ok ? "success" : "error",
		);
	},
};
