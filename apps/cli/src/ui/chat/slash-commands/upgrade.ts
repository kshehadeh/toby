import {
	getTobyVersion,
	isVersionNewer,
	normalizeReleaseVersion,
} from "@toby/core/version";
import {
	fetchLatestReleaseTag,
	resolveTobyGitHubRepo,
} from "../../../releases/github";
import { isScriptLaunch } from "../../../toby-launch-context";
import { downloadRelease } from "../../../upgrade/index";
import type { SlashCommand, SlashCommandRuntime } from "./types";

let activeDownload: Promise<void> | null = null;

export const upgradeSlashCommand: SlashCommand = {
	command: "/upgrade",
	description: "Download the latest Toby release to staging",
	helpText: `Download the latest Toby release to ~/.toby/staging.

  /upgrade

After download completes, run /restart to apply and relaunch.
In dev/script mode, use git pull or bun run build instead of applying a binary swap.`,
	async run(runtime) {
		if (activeDownload) {
			runtime.addNoticeLine("Upgrade download already in progress.", "info");
			return;
		}

		if (isScriptLaunch()) {
			runtime.addNoticeLine(
				"Running from source (bun/node). Binary upgrade is staged for ~/.local/bin/toby; use git pull or bun run build to update this session.",
				"info",
			);
		}

		try {
			const repo = resolveTobyGitHubRepo();
			const latestTag = await fetchLatestReleaseTag(repo);
			const latestVersion = normalizeReleaseVersion(latestTag);
			const currentVersion = getTobyVersion();

			if (!isVersionNewer(latestVersion, currentVersion)) {
				runtime.addNoticeLine(
					`Already on latest version (v${currentVersion}).`,
					"info",
				);
				runtime.setUpgradeStatus?.({ status: "idle" });
				return;
			}

			runtime.setUpgradeStatus?.({
				status: "downloading",
				tag: latestTag,
				progress: null,
			});
			runtime.addNoticeLine(`Downloading v${latestVersion}…`, "info");

			activeDownload = (async () => {
				try {
					const result = await downloadRelease({
						tag: latestTag,
						repo,
						onProgress: (progress) => {
							if (progress.phase === "downloading") {
								runtime.setUpgradeStatus?.({
									status: "downloading",
									tag: latestTag,
									progress: progress.percent ?? null,
								});
								return;
							}
							if (progress.phase === "extracting") {
								runtime.setUpgradeStatus?.({
									status: "extracting",
									tag: latestTag,
								});
								return;
							}
							if (progress.phase === "verifying") {
								runtime.setUpgradeStatus?.({
									status: "verifying",
									tag: latestTag,
								});
							}
						},
					});
					runtime.setUpgradeStatus?.({
						status: "ready",
						version: result.version,
					});
					runtime.addNoticeLine(
						`Download complete: v${result.version} staged. Run /restart to apply and relaunch.`,
						"success",
					);
					if (!runtime.launchContext.compiled) {
						runtime.addNoticeLine(
							"Note: /restart will relaunch this dev session without swapping the staged binary.",
							"info",
						);
					}
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					runtime.setUpgradeStatus?.({ status: "error", message });
					runtime.addNoticeLine(`Upgrade failed: ${message}`, "error");
				} finally {
					activeDownload = null;
				}
			})();

			await activeDownload;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			runtime.setUpgradeStatus?.({ status: "error", message });
			runtime.addNoticeLine(`Upgrade failed: ${message}`, "error");
		}
	},
};
