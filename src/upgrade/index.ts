import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { ensureTobyDir, resolveTobyDir } from "../config/index";
import {
	fetchLatestReleaseTag,
	resolveTobyGitHubRepo,
} from "../releases/github";
import { getTobyEntryScriptArgv } from "../toby-spawn";
import {
	getTobyVersion,
	isVersionNewer,
	normalizeReleaseVersion,
} from "../version";

export interface StagingManifest {
	readonly tag: string;
	readonly version: string;
	readonly asset: string;
	readonly repo: string;
	readonly installTarget: string;
	readonly completedAt: string;
}

export interface DownloadProgress {
	readonly bytesReceived: number;
	readonly totalBytes: number | null;
	readonly percent: number | null;
}

export interface DownloadReleaseOptions {
	readonly tag?: string;
	readonly repo?: string;
	readonly installDir?: string;
	readonly onProgress?: (progress: DownloadProgress) => void;
}

export interface DownloadReleaseResult {
	readonly tag: string;
	readonly version: string;
	readonly asset: string;
	readonly repo: string;
	readonly installTarget: string;
	readonly stagingBinaryPath: string;
}

export interface ApplyStagedResult {
	readonly installTarget: string;
	readonly version: string;
}

export function isRunningAsCompiledBinary(): boolean {
	return getTobyEntryScriptArgv() === null;
}

export function resolveInstallDir(optionInstallDir?: string): string {
	const rawPath =
		optionInstallDir?.trim() ||
		process.env.TOBY_INSTALL_DIR?.trim() ||
		path.join(os.homedir(), ".local", "bin");
	return path.resolve(rawPath);
}

export function resolveInstallTarget(installDir?: string): string {
	if (isRunningAsCompiledBinary()) {
		try {
			return fs.realpathSync(process.execPath);
		} catch {
			return process.execPath;
		}
	}
	return path.join(resolveInstallDir(installDir), "toby");
}

export function getStagingPaths(): {
	readonly stagingDir: string;
	readonly binaryPath: string;
	readonly manifestPath: string;
	readonly lockPath: string;
} {
	const stagingDir = path.join(resolveTobyDir(), "staging");
	return {
		stagingDir,
		binaryPath: path.join(stagingDir, "toby"),
		manifestPath: path.join(stagingDir, "manifest.json"),
		lockPath: path.join(stagingDir, ".lock"),
	};
}

export function resolveReleaseAsset(): string {
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

export async function readStagingManifest(): Promise<StagingManifest | null> {
	const { manifestPath } = getStagingPaths();
	try {
		const raw = await readFile(manifestPath, "utf8");
		return JSON.parse(raw) as StagingManifest;
	} catch {
		return null;
	}
}

export async function clearStaging(): Promise<void> {
	const { stagingDir, lockPath } = getStagingPaths();
	await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
	await rm(lockPath, { force: true }).catch(() => undefined);
}

async function acquireStagingLock(): Promise<() => Promise<void>> {
	ensureTobyDir();
	const { stagingDir, lockPath } = getStagingPaths();
	await mkdir(stagingDir, { recursive: true });
	try {
		await writeFile(
			lockPath,
			JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
			{ flag: "wx" },
		);
	} catch {
		throw new Error(
			"Another upgrade download is already in progress. Try again shortly.",
		);
	}
	return async () => {
		await rm(lockPath, { force: true }).catch(() => undefined);
	};
}

export async function downloadRelease(
	options: DownloadReleaseOptions = {},
): Promise<DownloadReleaseResult> {
	const repo = resolveTobyGitHubRepo(options.repo);
	const installTarget = resolveInstallTarget(options.installDir);
	const asset = resolveReleaseAsset();
	const tag = options.tag?.trim() || (await fetchLatestReleaseTag(repo));
	const version = normalizeReleaseVersion(tag);
	const currentVersion = getTobyVersion();

	if (!isVersionNewer(version, currentVersion)) {
		throw new Error(`Already on ${currentVersion} (latest is ${version}).`);
	}

	const downloadUrl = `https://github.com/${repo}/releases/download/${tag}/${asset}`;
	const { stagingDir, binaryPath, manifestPath } = getStagingPaths();
	const tempBinaryPath = path.join(
		stagingDir,
		`.toby-download-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);

	const releaseLock = await acquireStagingLock();
	try {
		await mkdir(stagingDir, { recursive: true });
		await rm(binaryPath, { force: true }).catch(() => undefined);
		await rm(manifestPath, { force: true }).catch(() => undefined);

		await downloadReleaseAsset(downloadUrl, tempBinaryPath, options.onProgress);
		await chmodExecutable(tempBinaryPath);

		const installedVersion = readInstalledVersion(tempBinaryPath);
		if (!installedVersion) {
			throw new Error(
				`Downloaded binary at ${tempBinaryPath} did not return a version for --version.`,
			);
		}
		if (installedVersion !== version) {
			throw new Error(
				[
					`Downloaded binary reports ${installedVersion}, but release ${tag} should be ${version}.`,
					"This usually means the release asset was built with stale version metadata.",
				].join(" "),
			);
		}

		await rename(tempBinaryPath, binaryPath);
		const manifest: StagingManifest = {
			tag,
			version,
			asset,
			repo,
			installTarget,
			completedAt: new Date().toISOString(),
		};
		await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

		return {
			tag,
			version,
			asset,
			repo,
			installTarget,
			stagingBinaryPath: binaryPath,
		};
	} catch (error) {
		await rm(tempBinaryPath, { force: true }).catch(() => undefined);
		throw error;
	} finally {
		await releaseLock();
	}
}

export async function applyStagedRelease(
	installTargetOverride?: string,
): Promise<ApplyStagedResult> {
	const manifest = await readStagingManifest();
	if (!manifest) {
		throw new Error(
			"No staged upgrade found. Run /upgrade or toby upgrade --download-only first.",
		);
	}

	const { binaryPath, manifestPath } = getStagingPaths();
	if (!fs.existsSync(binaryPath)) {
		throw new Error(`Staged binary missing at ${binaryPath}.`);
	}

	const installTarget = installTargetOverride ?? manifest.installTarget;
	await mkdir(path.dirname(installTarget), { recursive: true });

	const tempDestination = path.join(
		path.dirname(installTarget),
		`.toby-upgrade-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	await rm(tempDestination, { force: true }).catch(() => undefined);
	await rename(binaryPath, tempDestination);
	await chmodExecutable(tempDestination);
	await rename(tempDestination, installTarget);

	const installedVersion = readInstalledVersion(installTarget);
	if (!installedVersion) {
		throw new Error(
			`Installed binary at ${installTarget} did not return a version for --version.`,
		);
	}
	if (installedVersion !== manifest.version) {
		throw new Error(
			`Installed binary reports ${installedVersion}, but staged release should be ${manifest.version}.`,
		);
	}

	await rm(manifestPath, { force: true }).catch(() => undefined);

	return {
		installTarget,
		version: installedVersion,
	};
}

export async function runFullUpgrade(options: {
	readonly tag?: string;
	readonly repo?: string;
	readonly installDir?: string;
}): Promise<ApplyStagedResult> {
	const download = await downloadRelease(options);
	return applyStagedRelease(download.installTarget);
}

async function downloadReleaseAsset(
	downloadUrl: string,
	destinationPath: string,
	onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
	try {
		const response = await fetch(downloadUrl);
		if (!response.ok) {
			throw new Error(
				`Download failed: ${downloadUrl} (${response.status} ${response.statusText})`,
			);
		}

		const totalBytes = (() => {
			const header = response.headers.get("content-length");
			if (!header) {
				return null;
			}
			const parsed = Number.parseInt(header, 10);
			return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
		})();

		if (!response.body) {
			const arrayBuffer = await response.arrayBuffer();
			await writeFile(destinationPath, Buffer.from(arrayBuffer));
			onProgress?.({
				bytesReceived: arrayBuffer.byteLength,
				totalBytes,
				percent: totalBytes ? 100 : null,
			});
			return;
		}

		const reader = response.body.getReader();
		const chunks: Buffer[] = [];
		let bytesReceived = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			if (!value) {
				continue;
			}
			const chunk = Buffer.from(value);
			chunks.push(chunk);
			bytesReceived += chunk.length;
			onProgress?.({
				bytesReceived,
				totalBytes,
				percent:
					totalBytes !== null
						? Math.min(100, Math.round((bytesReceived / totalBytes) * 100))
						: null,
			});
		}

		await writeFile(destinationPath, Buffer.concat(chunks));
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

export function printPathGuidance(installDir: string): void {
	const pathEntries = process.env.PATH?.split(path.delimiter) ?? [];
	if (pathEntries.includes(installDir)) {
		return;
	}
	// Guidance is printed by CLI wrapper only.
	void installDir;
}
