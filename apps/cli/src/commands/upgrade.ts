import path from "node:path";
import process from "node:process";
import chalk from "chalk";
import type { Command } from "commander";
import {
	type UpgradeProgress,
	applyStagedReleaseDelegated,
	downloadRelease,
	readStagingManifest,
	resolveInstallDir,
	runFullUpgrade,
} from "../upgrade/index";

const PROGRESS_SPINNER_FRAMES = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏",
];
const PROGRESS_BAR_WIDTH = 24;
const CLEAR_PROGRESS_LINE = "\r\x1b[2K";

function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	if (bytes >= 1024) {
		return `${(bytes / 1024).toFixed(0)} KB`;
	}
	return `${bytes} B`;
}

/**
 * Returns an `onProgress` handler that renders an animated, single-line
 * upgrade indicator for download, extract, verify, and install phases.
 */
function makeProgressRenderer(): {
	readonly onProgress: (progress: UpgradeProgress) => void;
	readonly finish: () => void;
} {
	let frame = 0;
	let latestProgress: UpgradeProgress = { phase: "downloading" };
	let spinnerInterval: ReturnType<typeof setInterval> | null = null;
	const isTTY = Boolean(process.stdout.isTTY);

	const clearSpinner = () => {
		if (spinnerInterval) {
			clearInterval(spinnerInterval);
			spinnerInterval = null;
		}
	};

	const renderLine = () => {
		if (!isTTY) {
			return;
		}
		const spinner =
			PROGRESS_SPINNER_FRAMES[frame % PROGRESS_SPINNER_FRAMES.length];
		let line: string;
		switch (latestProgress.phase) {
			case "downloading": {
				if (
					latestProgress.percent !== null &&
					latestProgress.percent !== undefined
				) {
					const filled = Math.round(
						(latestProgress.percent / 100) * PROGRESS_BAR_WIDTH,
					);
					const bar = `${"█".repeat(filled)}${"░".repeat(PROGRESS_BAR_WIDTH - filled)}`;
					line = `${spinner} Downloading [${bar}] ${latestProgress.percent}%`;
				} else {
					line = `${spinner} Downloading… ${formatBytes(latestProgress.bytesReceived ?? 0)}`;
				}
				break;
			}
			case "extracting":
				line = `${spinner} Extracting release…`;
				break;
			case "verifying":
				line = `${spinner} Verifying release…`;
				break;
			case "installing":
				line = latestProgress.detail
					? `${spinner} Installing ${latestProgress.detail}…`
					: `${spinner} Installing…`;
				break;
		}
		process.stdout.write(`\r${line}\x1b[K`);
	};

	const ensureSpinner = () => {
		if (spinnerInterval) {
			return;
		}
		spinnerInterval = setInterval(() => {
			frame += 1;
			renderLine();
		}, 100);
	};

	const onProgress = (progress: UpgradeProgress) => {
		latestProgress = progress;
		if (progress.phase === "downloading") {
			clearSpinner();
			frame += 1;
			renderLine();
			return;
		}
		frame += 1;
		renderLine();
		ensureSpinner();
	};

	return { onProgress, finish: clearSpinner };
}

function finishProgressRenderer(renderer: {
	readonly finish: () => void;
}): void {
	renderer.finish();
	if (process.stdout.isTTY) {
		process.stdout.write(CLEAR_PROGRESS_LINE);
	} else {
		process.stdout.write("\n");
	}
}

interface UpgradeCommandOptions {
	version?: string;
	repo?: string;
	installDir?: string;
	installTarget?: string;
	downloadOnly?: boolean;
	applyStaged?: boolean;
}

export function registerUpgradeCommand(program: Command): void {
	program
		.command("upgrade")
		.description("Download and install the latest Toby release")
		.option(
			"-v, --version <tag>",
			"Install a specific release tag (defaults to latest)",
		)
		.option(
			"--repo <owner/name>",
			"GitHub repo to install from (defaults to kshehadeh/toby)",
		)
		.option(
			"--install-dir <path>",
			"Install directory for the toby binary (defaults to ~/.local/bin)",
		)
		.option(
			"--download-only",
			"Download release to ~/.toby/staging without installing",
			false,
		)
		.option(
			"--apply-staged",
			"Install a previously staged download from ~/.toby/staging",
			false,
		)
		.option(
			"--install-target <path>",
			"Override install target when applying a staged upgrade (internal/delegated apply)",
		)
		.action(async (options: UpgradeCommandOptions) => {
			try {
				await runUpgrade(options);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(message));
				process.exitCode = 1;
			}
		});
}

async function runUpgrade(options: UpgradeCommandOptions): Promise<void> {
	const installDir = resolveInstallDir(options.installDir);

	if (options.applyStaged) {
		const manifest = await readStagingManifest();
		if (!manifest) {
			throw new Error(
				"No staged upgrade found. Run toby upgrade --download-only first.",
			);
		}
		console.log(
			chalk.cyan(`Applying staged upgrade to ${manifest.version}...`),
		);
		const renderProgress = makeProgressRenderer();
		const applied = await applyStagedReleaseDelegated(
			options.installTarget ?? manifest.installTarget,
			{
				onProgress: renderProgress.onProgress,
			},
		);
		finishProgressRenderer(renderProgress);
		console.log(chalk.green(`Installed: ${applied.installTarget}`));
		console.log(chalk.green(`Verified: ${applied.version}`));
		if (applied.daemonRestarted) {
			const intervalText =
				applied.daemonIntervalSeconds === null
					? "default interval"
					: `${applied.daemonIntervalSeconds}s interval`;
			console.log(
				chalk.dim(
					`Daemon was running and has been restarted (${intervalText}).`,
				),
			);
		}
		printPathGuidanceWithChalk(installDir);
		return;
	}

	if (options.downloadOnly) {
		const renderProgress = makeProgressRenderer();
		const result = await downloadRelease({
			tag: options.version,
			repo: options.repo,
			installDir: options.installDir,
			onProgress: renderProgress.onProgress,
		});
		finishProgressRenderer(renderProgress);
		console.log(
			chalk.green(
				`Staged ${result.version} at ~/.toby/staging/toby. Run /restart in chat or toby upgrade --apply-staged to install.`,
			),
		);
		return;
	}

	console.log(chalk.cyan("Upgrading Toby to the latest release..."));
	const renderProgress = makeProgressRenderer();
	const applied = await runFullUpgrade({
		tag: options.version,
		repo: options.repo,
		installDir: options.installDir,
		onProgress: renderProgress.onProgress,
	});
	finishProgressRenderer(renderProgress);
	console.log(chalk.green(`Installed: ${applied.installTarget}`));
	console.log(chalk.green(`Verified: ${applied.version}`));
	if (applied.daemonRestarted) {
		const intervalText =
			applied.daemonIntervalSeconds === null
				? "default interval"
				: `${applied.daemonIntervalSeconds}s interval`;
		console.log(
			chalk.dim(`Daemon was running and has been restarted (${intervalText}).`),
		);
	}
	printPathGuidanceWithChalk(installDir);
}

function printPathGuidanceWithChalk(installDir: string): void {
	const pathEntries = process.env.PATH?.split(path.delimiter) ?? [];
	if (pathEntries.includes(installDir)) {
		console.log(chalk.dim(`${installDir} is already on your PATH.`));
		return;
	}

	console.log();
	console.log(
		chalk.yellow(
			`${installDir} is not on your PATH, so "toby" may not resolve from this install.`,
		),
	);
	console.log(
		chalk.dim(
			"Add it to your shell profile, then open a new terminal (or source the profile file).",
		),
	);
}
