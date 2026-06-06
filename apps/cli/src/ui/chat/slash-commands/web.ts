import { getWebConfig } from "@toby/core/config/index";
import { openWebUiInBrowser } from "@toby/core/web/open-ui";
import { getWebUiUrl } from "@toby/core/web/server";
import { ensureDaemonRunning } from "../../../schedules/daemon-status";
import type { SlashCommand } from "./types";

export const webSlashCommand: SlashCommand = {
	command: "/web",
	description: "Open the local web UI in your browser.",
	helpText:
		"Starts the daemon if it is not running, then opens the Toby web UI in your default browser.",
	async run(runtime) {
		const webCfg = getWebConfig();
		if (!webCfg.enabled) {
			runtime.addNoticeLine(
				"Web UI is disabled. Set web.enabled to true in ~/.toby/config.json.",
				"error",
			);
			return;
		}

		const url = getWebUiUrl(webCfg.port);

		try {
			const daemon = await ensureDaemonRunning();
			if (!daemon.running) {
				runtime.addNoticeLine(
					"Failed to start daemon. Try `toby daemon start` or `/start-daemon`.",
					"error",
				);
				return;
			}

			if (!daemon.wasAlreadyRunning) {
				runtime.addNoticeLine(`Daemon started (PID ${daemon.pid}).`, "success");
			}

			const opened = await openWebUiInBrowser(url);
			if (opened) {
				runtime.addNoticeLine(`Opened ${url} in your browser.`, "success");
			} else {
				runtime.addNoticeLine(
					`Could not open browser. Visit this URL manually:\n${url}`,
					"info",
				);
			}
		} catch (e) {
			runtime.addNoticeLine(
				`Failed to open web UI: ${e instanceof Error ? e.message : String(e)}`,
				"error",
			);
		}
	},
};
