import path from "node:path";
import process from "node:process";
import chalk from "chalk";
import type { Command } from "commander";
import {
	type DownloadProgress,
	applyStagedRelease,
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
 * download indicator. Shows a filled bar with percentage when the total size
 * is known, otherwise a spinner with bytes received.
 */
function makeProgressRenderer(): (progress: DownloadProgress) => void {
	let frame = 0;
	const isTTY = Boolean(process.stdout.isTTY);
	return (progress) => {
		const spinner =
			PROGRESS_SPINNER_FRAMES[frame % PROGRESS_SPINNER_FRAMES.length];
		frame += 1;
		if (progress.percent !== null) {
			const filled = Math.round((progress.percent / 100) * PROGRESS_BAR_WIDTH);
			const bar = `${"█".repeat(filled)}${"░".repeat(PROGRESS_BAR_WIDTH - filled)}`;
			const line = `${spinner} Downloading [${bar}] ${progress.percent}%`;
			if (isTTY) {
				process.stdout.write(`\r${line}`);
			}
			return;
		}
		if (isTTY) {
			process.stdout.write(
				`\r${spinner} Downloading… ${formatBytes(progress.bytesReceived)}`,
			);
		}
	};
}

interface UpgradeCommandOptions {
	version?: string;
	repo?: string;
	installDir?: string;
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
		const applied = await applyStagedRelease(manifest.installTarget);
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
			onProgress: renderProgress,
		});
		process.stdout.write("\n");
		console.log(
			chalk.green(
				`Staged ${result.version} at ~/.toby/staging/toby. Run /restart in chat or toby upgrade --apply-staged to install.`,
			),
		);
		return;
	}

	console.log(chalk.cyan("Upgrading Toby to the latest release..."));
	const applied = await runFullUpgrade({
		tag: options.version,
		repo: options.repo,
		installDir: options.installDir,
		onProgress: makeProgressRenderer(),
	});
	process.stdout.write("\n");
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
