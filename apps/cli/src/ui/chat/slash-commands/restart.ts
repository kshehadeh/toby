import { spawnUpgradeHandoff } from "../../../upgrade/handoff-spawn";
import { readStagingManifest } from "../../../upgrade/index";
import type { SlashCommand } from "./types";

export const restartSlashCommand: SlashCommand = {
	command: "/restart",
	description: "Restart Toby and apply a staged upgrade if ready",
	helpText: `Restart this Toby session with the same launch arguments.

  /restart

If a staged upgrade exists and you are running a compiled binary, the upgrade
is applied after this session exits, then Toby relaunches automatically.`,
	async run(runtime) {
		const applyStaged =
			runtime.launchContext.compiled && (await readStagingManifest()) !== null;

		try {
			spawnUpgradeHandoff({
				launchContext: runtime.launchContext,
				applyStaged,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			runtime.addNoticeLine(`Restart failed: ${message}`, "error");
			return;
		}

		if (applyStaged) {
			runtime.addNoticeLine(
				"Restarting… staged upgrade will be applied, then Toby will relaunch.",
				"info",
			);
		} else {
			runtime.addNoticeLine("Restarting…", "info");
		}
		runtime.exit();
	},
};
