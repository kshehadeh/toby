import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
	ensureTobyDir,
	getHelpersDir,
	resolveTobyDir,
} from "@toby/core/config/index";
import {
	getTobyEntryScriptArgv,
	isRunningAsCompiledBinary,
} from "@toby/core/toby-spawn";
import {
	getTobyVersion,
	isVersionNewer,
	normalizeReleaseVersion,
} from "@toby/core/version";
import {
	fetchLatestReleaseTag,
	resolveTobyGitHubRepo,
} from "../releases/github";
import { restartDaemonIfRunning } from "../schedules/daemon-status";

export { isRunningAsCompiledBinary };

export interface StagingManifest {
	readonly tag: string;
	readonly version: string;
	readonly asset: string;
	readonly repo: string;
	readonly installTarget: string;
	readonly listenerInstallTarget?: string;
	readonly macOSHelperInstallTarget?: string;
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
	readonly daemonRestarted: boolean;
	readonly daemonIntervalSeconds: number | null;
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

export function resolveListenerInstallTarget(_installDir?: string): string {
	return path.join(getHelpersDir(), "toby-listener");
}

export function resolveMacOSHelperInstallTarget(_installDir?: string): string {
	return path.join(getHelpersDir(), "toby-macos");
}

export function getStagingPaths(): {
	readonly stagingDir: string;
	readonly binaryPath: string;
	readonly listenerPath: string;
	readonly macOSHelperPath: string;
	readonly pluginSamplePath: string;
	readonly archivePath: string;
	readonly manifestPath: string;
	readonly lockPath: string;
} {
	const stagingDir = path.join(resolveTobyDir(), "staging");
	return {
		stagingDir,
		binaryPath: path.join(stagingDir, "toby"),
		listenerPath: path.join(stagingDir, "toby-listener"),
		macOSHelperPath: path.join(stagingDir, "toby-macos"),
		pluginSamplePath: path.join(stagingDir, "toby-plugin-sample"),
		archivePath: path.join(stagingDir, "toby-release.zip"),
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

	throw new Error(
		`Unsupported operating system: ${platform} (macOS is supported).`,
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
	const listenerInstallTarget = resolveListenerInstallTarget(
		options.installDir,
	);
	const macOSHelperInstallTarget = resolveMacOSHelperInstallTarget(
		options.installDir,
	);
	const asset = `${resolveReleaseAsset()}.zip`;
	const tag = options.tag?.trim() || (await fetchLatestReleaseTag(repo));
	const version = normalizeReleaseVersion(tag);
	const currentVersion = getTobyVersion();

	if (!isVersionNewer(version, currentVersion)) {
		throw new Error(`Already on ${currentVersion} (latest is ${version}).`);
	}

	const downloadUrl = `https://github.com/${repo}/releases/download/${tag}/${asset}`;
	const {
		stagingDir,
		binaryPath,
		listenerPath,
		macOSHelperPath,
		pluginSamplePath,
		archivePath,
		manifestPath,
	} = getStagingPaths();
	const tempArchivePath = path.join(
		stagingDir,
		`.toby-download-${Date.now()}-${Math.random().toString(16).slice(2)}.zip`,
	);

	const releaseLock = await acquireStagingLock();
	try {
		await mkdir(stagingDir, { recursive: true });
		await rm(binaryPath, { force: true }).catch(() => undefined);
		await rm(listenerPath, { force: true }).catch(() => undefined);
		await rm(macOSHelperPath, { force: true }).catch(() => undefined);
		await rm(pluginSamplePath, { force: true }).catch(() => undefined);
		await rm(archivePath, { force: true }).catch(() => undefined);
		await rm(manifestPath, { force: true }).catch(() => undefined);

		await downloadReleaseAsset(
			downloadUrl,
			tempArchivePath,
			options.onProgress,
		);
		await extractReleaseArchive(tempArchivePath, stagingDir);
		await chmodExecutable(binaryPath);
		await chmodExecutable(listenerPath);
		if (fs.existsSync(macOSHelperPath)) {
			await chmodExecutable(macOSHelperPath);
		}

		const installedVersion = readInstalledVersion(binaryPath);
		if (!installedVersion) {
			throw new Error(
				`Downloaded binary at ${binaryPath} did not return a version for --version.`,
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

		await rename(tempArchivePath, archivePath);
		const manifest: StagingManifest = {
			tag,
			version,
			asset,
			repo,
			installTarget,
			listenerInstallTarget,
			macOSHelperInstallTarget,
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
		await rm(tempArchivePath, { force: true }).catch(() => undefined);
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

	const { binaryPath, listenerPath, macOSHelperPath, manifestPath } =
		getStagingPaths();
	if (!fs.existsSync(binaryPath)) {
		throw new Error(`Staged binary missing at ${binaryPath}.`);
	}
	if (!fs.existsSync(listenerPath)) {
		throw new Error(`Staged listener helper missing at ${listenerPath}.`);
	}

	const installTarget = installTargetOverride ?? manifest.installTarget;
	const listenerInstallTarget =
		manifest.listenerInstallTarget ?? resolveListenerInstallTarget();
	const macOSHelperInstallTarget =
		manifest.macOSHelperInstallTarget ?? resolveMacOSHelperInstallTarget();
	await mkdir(path.dirname(installTarget), { recursive: true });
	await mkdir(path.dirname(listenerInstallTarget), { recursive: true });

	const tempDestination = path.join(
		path.dirname(installTarget),
		`.toby-upgrade-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	await rm(tempDestination, { force: true }).catch(() => undefined);
	await rename(binaryPath, tempDestination);
	await chmodExecutable(tempDestination);
	await rename(tempDestination, installTarget);

	const tempListenerDestination = path.join(
		path.dirname(listenerInstallTarget),
		`.toby-listener-upgrade-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	await rm(tempListenerDestination, { force: true }).catch(() => undefined);
	await rename(listenerPath, tempListenerDestination);
	await chmodExecutable(tempListenerDestination);
	await rename(tempListenerDestination, listenerInstallTarget);

	// Apply macOS system helper if it exists in staging
	if (fs.existsSync(macOSHelperPath)) {
		const tempMacOSDestination = path.join(
			path.dirname(macOSHelperInstallTarget),
			`.toby-macos-upgrade-${Date.now()}-${Math.random().toString(16).slice(2)}`,
		);
		await rm(tempMacOSDestination, { force: true }).catch(() => undefined);
		await rename(macOSHelperPath, tempMacOSDestination);
		await chmodExecutable(tempMacOSDestination);
		await rename(tempMacOSDestination, macOSHelperInstallTarget);
	}

	// Migration: older installs placed helper binaries next to `toby` on PATH.
	// Now that helpers live under ~/.toby/helpers, remove the stale siblings so
	// only `toby` remains in the bin directory.
	await removeLegacySiblingHelpers(installTarget, [
		listenerInstallTarget,
		macOSHelperInstallTarget,
	]);

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

	const daemonRestart = await restartDaemonIfRunning();

	await rm(manifestPath, { force: true }).catch(() => undefined);

	return {
		installTarget,
		version: installedVersion,
		daemonRestarted: daemonRestart.restarted,
		daemonIntervalSeconds: daemonRestart.intervalSeconds,
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

const LEGACY_SIBLING_HELPER_NAMES = ["toby-listener", "toby-macos"] as const;

/**
 * Remove helper binaries that older installers left next to the `toby` binary
 * on PATH. Helpers now live under ~/.toby/helpers, so the siblings are stale
 * duplicates. Best-effort: never fails the upgrade, and never touches the new
 * helper targets (in case someone points the bin dir at the helpers dir).
 */
export async function removeLegacySiblingHelpers(
	installTarget: string,
	newHelperTargets: readonly string[],
): Promise<void> {
	const binDir = path.dirname(installTarget);
	const keep = new Set(newHelperTargets.map((target) => path.resolve(target)));
	for (const name of LEGACY_SIBLING_HELPER_NAMES) {
		const siblingPath = path.join(binDir, name);
		if (keep.has(path.resolve(siblingPath))) {
			continue;
		}
		if (!fs.existsSync(siblingPath)) {
			continue;
		}
		await rm(siblingPath, { force: true }).catch(() => undefined);
	}
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

async function extractReleaseArchive(
	archivePath: string,
	destinationDir: string,
): Promise<void> {
	const result = spawnSync(
		"unzip",
		["-o", "-q", archivePath, "-d", destinationDir],
		{
			encoding: "utf8",
		},
	);
	if (result.status !== 0) {
		throw new Error(
			`Failed to extract ${archivePath}: ${result.stderr || "unknown error"}`,
		);
	}
	for (const fileName of ["toby", "toby-listener"]) {
		const filePath = path.join(destinationDir, fileName);
		if (!fs.existsSync(filePath)) {
			throw new Error(`Release archive is missing ${fileName}.`);
		}
	}
	// toby-macos may not exist in older releases — that's fine, we skip it gracefully
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
