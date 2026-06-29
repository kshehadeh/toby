import { getWebConfig } from "@toby/core/config/index";
import { ensureDaemonRunning } from "../../../schedules/daemon-status";
import { launchTobyApp, resolveTobyAppPath } from "../toby-app-launcher";
import type { SlashCommand } from "./types";

export const appSlashCommand: SlashCommand = {
	command: "/app",
	description: "Open the native Toby chat app.",
	helpText:
		"Starts the server if needed, then launches the native macOS Toby chat app.",
	async run(runtime) {
		const webCfg = getWebConfig();
		if (!webCfg.enabled) {
			runtime.addNoticeLine(
				"Web UI is disabled. Set web.enabled to true in ~/.toby/config.json.",
				"error",
			);
			return;
		}

		try {
			const daemon = await ensureDaemonRunning();
			if (!daemon.running) {
				runtime.addNoticeLine(
					"Failed to start server. Try `toby daemon start` or `/restart-server`.",
					"error",
				);
				return;
			}
			if (!daemon.wasAlreadyRunning) {
				runtime.addNoticeLine(`Server started (PID ${daemon.pid}).`, "success");
			}

			const resolved = resolveTobyAppPath();
			if (!resolved) {
				runtime.addNoticeLine(
					"Toby app not found. Run `/install-app` or reinstall from the latest release.",
					"error",
				);
				return;
			}

			const launched = launchTobyApp(resolved);
			runtime.addNoticeLine(
				launched.message,
				launched.ok ? "success" : "error",
			);
		} catch (e) {
			runtime.addNoticeLine(
				`Failed to launch app: ${e instanceof Error ? e.message : String(e)}`,
				"error",
			);
		}
	},
};
