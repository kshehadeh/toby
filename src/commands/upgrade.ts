import { spawnSync } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import chalk from "chalk";
import type { Command } from "commander";
import {
	fetchLatestReleaseTag,
	resolveTobyGitHubRepo,
} from "../releases/github";
import { normalizeReleaseVersion } from "../version";

interface UpgradeCommandOptions {
	version?: string;
	repo?: string;
	installDir?: string;
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
	const repo = resolveTobyGitHubRepo(options.repo);
	const installDir = resolveInstallDir(options.installDir);
	const asset = resolveReleaseAsset();
	const tag = options.version?.trim() || (await fetchLatestReleaseTag(repo));
	const downloadUrl = `https://github.com/${repo}/releases/download/${tag}/${asset}`;
	const destination = path.join(installDir, "toby");
	const tempDestination = path.join(
		installDir,
		`.toby-upgrade-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);

	console.log(
		chalk.cyan(`Upgrading Toby to ${tag} (${asset}) from ${repo}...`),
	);

	await mkdir(installDir, { recursive: true });
	await downloadReleaseAsset(downloadUrl, tempDestination);
	await chmodExecutable(tempDestination);
	await rename(tempDestination, destination);

	const installedVersion = readInstalledVersion(destination);
	const expectedVersion = normalizeReleaseVersion(tag);
	console.log(chalk.green(`Installed: ${destination}`));
	if (installedVersion) {
		console.log(chalk.green(`Verified: ${installedVersion}`));
		if (installedVersion !== expectedVersion) {
			throw new Error(
				[
					`Installed binary reports ${installedVersion}, but release ${tag} should be ${expectedVersion}.`,
					"This usually means the release asset was built with stale version metadata.",
					"Please rebuild and re-upload the release binary for this tag.",
				].join(" "),
			);
		}
	} else {
		throw new Error(
			`Installed binary at ${destination} did not return a version for --version.`,
		);
	}

	printPathGuidance(installDir);
}

function resolveInstallDir(optionInstallDir?: string): string {
	const rawPath =
		optionInstallDir?.trim() ||
		process.env.TOBY_INSTALL_DIR?.trim() ||
		path.join(os.homedir(), ".local", "bin");
	return path.resolve(rawPath);
}

function resolveReleaseAsset(): string {
	const platform = os.platform();
	const architecture = os.arch();

	if (platform === "darwin") {
		if (architecture === "arm64") {
			return "toby-darwin-arm64";
		}
		if (architecture === "x64") {
			return "toby-darwin-x64";
		}
		throw new Error(
			`Unsupported macOS architecture: ${architecture} (need arm64 or x64).`,
		);
	}

	if (platform === "linux") {
		if (architecture === "arm64") {
			return "toby-linux-arm64";
		}
		if (architecture === "x64") {
			return "toby-linux-x64";
		}
		throw new Error(
			`Unsupported Linux architecture: ${architecture} (need arm64 or x64).`,
		);
	}

	throw new Error(
		`Unsupported operating system: ${platform} (macOS and Linux are supported).`,
	);
}

async function downloadReleaseAsset(
	downloadUrl: string,
	destinationPath: string,
): Promise<void> {
	try {
		const response = await fetch(downloadUrl);
		if (!response.ok) {
			throw new Error(
				`Download failed: ${downloadUrl} (${response.status} ${response.statusText})`,
			);
		}
		const arrayBuffer = await response.arrayBuffer();
		await writeFile(destinationPath, Buffer.from(arrayBuffer));
	} catch (error) {
		await rm(destinationPath, { force: true }).catch(() => undefined);
		throw error;
	}
}

async function chmodExecutable(filePath: string): Promise<void> {
	const chmodResult = spawnSync("chmod", ["+x", filePath], {
		encoding: "utf8",
	});
	if (chmodResult.status !== 0) {
		throw new Error(
			`Failed to mark ${filePath} executable: ${chmodResult.stderr || "unknown error"}`,
		);
	}
}

function readInstalledVersion(binaryPath: string): string | null {
	const env = { ...process.env };
	env.npm_package_version = undefined;
	const result = spawnSync(binaryPath, ["--version"], {
		encoding: "utf8",
		env,
	});
	if (result.status !== 0) {
		return null;
	}
	return result.stdout.trim() || null;
}

function printPathGuidance(installDir: string): void {
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
