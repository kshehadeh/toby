import { spawnSync } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import chalk from "chalk";
import type { Command } from "commander";

interface UpgradeCommandOptions {
	version?: string;
	repo?: string;
	installDir?: string;
}

interface ReleaseResponse {
	tag_name?: string;
}

const DEFAULT_REPO = "kshehadeh/toby";

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
	const repo = resolveRepo(options.repo);
	const installDir = resolveInstallDir(options.installDir);
	const asset = resolveReleaseAsset();
	const tag = options.version?.trim() || (await fetchLatestTag(repo));
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
	console.log(chalk.green(`Installed: ${destination}`));
	if (installedVersion) {
		console.log(chalk.green(`Verified: ${installedVersion}`));
	}

	printPathGuidance(installDir);
}

function resolveRepo(optionRepo?: string): string {
	return (
		optionRepo?.trim() ||
		process.env.TOBY_REPO?.trim() ||
		detectRepoFromGitRemote() ||
		DEFAULT_REPO
	);
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

async function fetchLatestTag(repo: string): Promise<string> {
	const headers = new Headers({
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	});
	if (process.env.GITHUB_TOKEN) {
		headers.set("Authorization", `Bearer ${process.env.GITHUB_TOKEN}`);
	}

	const response = await fetch(
		`https://api.github.com/repos/${repo}/releases/latest`,
		{
			headers,
		},
	);
	if (!response.ok) {
		throw new Error(
			`Failed to resolve latest release for ${repo}: ${response.status} ${response.statusText}`,
		);
	}

	const release = (await response.json()) as ReleaseResponse;
	const tag = release.tag_name?.trim();
	if (!tag) {
		throw new Error(`Could not determine latest release tag for ${repo}.`);
	}
	return tag;
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
	const result = spawnSync(binaryPath, ["--version"], { encoding: "utf8" });
	if (result.status !== 0) {
		return null;
	}
	return result.stdout.trim() || null;
}

function detectRepoFromGitRemote(): string | null {
	const rootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], {
		encoding: "utf8",
	});
	if (rootResult.status !== 0) {
		return null;
	}
	const root = rootResult.stdout.trim();
	if (!root) {
		return null;
	}

	const remoteResult = spawnSync(
		"git",
		["-C", root, "config", "--get", "remote.origin.url"],
		{ encoding: "utf8" },
	);
	if (remoteResult.status !== 0) {
		return null;
	}

	return parseGitHubRepo(remoteResult.stdout.trim());
}

function parseGitHubRepo(remoteUrl: string): string | null {
	if (remoteUrl.startsWith("git@github.com:")) {
		return remoteUrl.replace("git@github.com:", "").replace(/\.git$/, "");
	}
	if (remoteUrl.startsWith("https://github.com/")) {
		return remoteUrl.replace("https://github.com/", "").replace(/\.git$/, "");
	}
	return null;
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
