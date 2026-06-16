import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
	ensureTobyDir,
	getHelpersDir,
	getPluginsDir,
	resolveTobyDir,
} from "@toby/core/config/index";
import { copyPluginResourceBundlesFromSource } from "@toby/core/integrations/plugins/install";
import { ensureWhisperPluginSetup } from "@toby/core/listen/transcription-plugin";
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
import { resolveInstallApplicationsDir } from "../ui/chat/toby-app-launcher";

export { isRunningAsCompiledBinary };

export interface StagingManifest {
	readonly tag: string;
	readonly version: string;
	readonly asset: string;
	readonly repo: string;
	readonly installTarget: string;
	readonly listenerInstallTarget?: string;
	readonly completedAt: string;
}

export type UpgradeProgressPhase =
	| "downloading"
	| "extracting"
	| "verifying"
	| "installing";

export interface UpgradeProgress {
	readonly phase: UpgradeProgressPhase;
	readonly bytesReceived?: number;
	readonly totalBytes?: number | null;
	readonly percent?: number | null;
	readonly detail?: string;
}

/** @deprecated Use {@link UpgradeProgress} */
export type DownloadProgress = UpgradeProgress;

export interface DownloadReleaseOptions {
	readonly tag?: string;
	readonly repo?: string;
	readonly installDir?: string;
	readonly onProgress?: (progress: UpgradeProgress) => void;
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

export function resolveWebInstallTarget(installDir?: string): string {
	return path.join(path.dirname(resolveInstallTarget(installDir)), "web");
}

export function resolveAppInstallTarget(installDir?: string): string {
	return path.join(path.dirname(resolveInstallTarget(installDir)), "Toby.app");
}

export function getStagingPaths(): {
	readonly stagingDir: string;
	readonly binaryPath: string;
	readonly listenerPath: string;
	readonly pluginSamplePath: string;
	readonly pluginAzureadPath: string;
	readonly pluginGmailPath: string;
	readonly pluginTodoistPath: string;
	readonly pluginSlackPath: string;
	readonly pluginJiraPath: string;
	readonly pluginWebsearchPath: string;
	readonly pluginApplecalendarPath: string;
	readonly pluginMacosPath: string;
	readonly pluginWhisperPath: string;
	readonly appPath: string;
	readonly webPath: string;
	readonly archivePath: string;
	readonly manifestPath: string;
	readonly lockPath: string;
} {
	const stagingDir = path.join(resolveTobyDir(), "staging");
	return {
		stagingDir,
		binaryPath: path.join(stagingDir, "toby"),
		listenerPath: path.join(stagingDir, "toby-listener"),
		pluginSamplePath: path.join(stagingDir, "toby-plugin-sample"),
		pluginAzureadPath: path.join(stagingDir, "toby-plugin-azuread"),
		pluginGmailPath: path.join(stagingDir, "toby-plugin-gmail"),
		pluginTodoistPath: path.join(stagingDir, "toby-plugin-todoist"),
		pluginSlackPath: path.join(stagingDir, "toby-plugin-slack"),
		pluginJiraPath: path.join(stagingDir, "toby-plugin-jira"),
		pluginWebsearchPath: path.join(stagingDir, "toby-plugin-websearch"),
		pluginApplecalendarPath: path.join(stagingDir, "toby-plugin-applecalendar"),
		pluginMacosPath: path.join(stagingDir, "toby-plugin-macos"),
		pluginWhisperPath: path.join(stagingDir, "toby-plugin-whisper"),
		appPath: path.join(stagingDir, "Toby.app"),
		webPath: path.join(stagingDir, "web"),
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
		pluginSamplePath,
		pluginAzureadPath,
		pluginGmailPath,
		pluginTodoistPath,
		pluginSlackPath,
		pluginJiraPath,
		pluginWebsearchPath,
		pluginApplecalendarPath,
		pluginMacosPath,
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
		await rm(pluginSamplePath, { force: true }).catch(() => undefined);
		await rm(pluginAzureadPath, { force: true }).catch(() => undefined);
		await rm(pluginGmailPath, { force: true }).catch(() => undefined);
		await rm(pluginTodoistPath, { force: true }).catch(() => undefined);
		await rm(pluginSlackPath, { force: true }).catch(() => undefined);
		await rm(pluginJiraPath, { force: true }).catch(() => undefined);
		await rm(pluginWebsearchPath, { force: true }).catch(() => undefined);
		await rm(pluginApplecalendarPath, { force: true }).catch(() => undefined);
		await rm(pluginMacosPath, { force: true }).catch(() => undefined);
		await rm(archivePath, { force: true }).catch(() => undefined);
		await rm(manifestPath, { force: true }).catch(() => undefined);

		await downloadReleaseAsset(
			downloadUrl,
			tempArchivePath,
			options.onProgress,
		);
		options.onProgress?.({ phase: "extracting" });
		await yieldToEventLoop();
		await extractReleaseArchive(tempArchivePath, stagingDir);
		options.onProgress?.({ phase: "verifying" });
		await yieldToEventLoop();
		await chmodExecutable(binaryPath);
		await chmodExecutable(listenerPath);

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

export function resolveStagedBinaryPath(): string {
	return getStagingPaths().binaryPath;
}

/** True when a staged release binary should run apply-staged (old install upgrading). */
export function shouldDelegateApplyToStagedBinary(): boolean {
	if (!isRunningAsCompiledBinary()) {
		return false;
	}
	const stagedBinary = resolveStagedBinaryPath();
	if (!fs.existsSync(stagedBinary)) {
		return false;
	}
	try {
		fs.accessSync(stagedBinary, fs.constants.X_OK);
	} catch {
		return false;
	}
	try {
		return fs.realpathSync(process.execPath) !== fs.realpathSync(stagedBinary);
	} catch {
		return process.execPath !== stagedBinary;
	}
}

export async function applyStagedReleaseDelegated(
	installTargetOverride?: string,
	options?: { readonly onProgress?: (progress: UpgradeProgress) => void },
): Promise<ApplyStagedResult> {
	if (!shouldDelegateApplyToStagedBinary()) {
		return applyStagedRelease(installTargetOverride, options);
	}

	const stagedBinary = resolveStagedBinaryPath();
	const args = ["upgrade", "--apply-staged"];
	if (installTargetOverride) {
		args.push("--install-target", installTargetOverride);
	}

	const result = spawnSync(stagedBinary, args, { encoding: "utf8" });
	if (result.status !== 0) {
		const detail = (result.stderr || result.stdout || "").trim();
		throw new Error(
			detail
				? `Staged upgrade apply failed: ${detail}`
				: `Staged upgrade apply failed with exit code ${result.status ?? 1}.`,
		);
	}

	const manifest = await readStagingManifest();
	const installTarget = installTargetOverride ?? manifest?.installTarget;
	if (!installTarget) {
		throw new Error(
			"Staged upgrade apply completed but install target is unknown.",
		);
	}
	const installedVersion = readInstalledVersion(installTarget);
	if (!installedVersion) {
		throw new Error(
			`Installed binary at ${installTarget} did not return a version for --version.`,
		);
	}

	return {
		installTarget,
		version: installedVersion,
		daemonRestarted: false,
		daemonIntervalSeconds: null,
	};
}

export async function applyStagedRelease(
	installTargetOverride?: string,
	options?: { readonly onProgress?: (progress: UpgradeProgress) => void },
): Promise<ApplyStagedResult> {
	ensureTobyDir();
	options?.onProgress?.({ phase: "installing", detail: "toby" });
	await yieldToEventLoop();
	const manifest = await readStagingManifest();
	if (!manifest) {
		throw new Error(
			"No staged upgrade found. Run /upgrade or toby upgrade --download-only first.",
		);
	}

	const { binaryPath, listenerPath, webPath, appPath, manifestPath } =
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

	if (fs.existsSync(path.join(webPath, "index.html"))) {
		options?.onProgress?.({ phase: "installing", detail: "web UI" });
		await yieldToEventLoop();
		const webInstallTarget = path.join(path.dirname(installTarget), "web");
		await rm(webInstallTarget, { recursive: true, force: true });
		await cp(webPath, webInstallTarget, { recursive: true });
	}

	if (fs.existsSync(path.join(appPath, "Contents", "MacOS", "toby-app"))) {
		options?.onProgress?.({ phase: "installing", detail: "native app" });
		await yieldToEventLoop();
		const applicationsDir = resolveInstallApplicationsDir();
		await mkdir(applicationsDir, { recursive: true });
		const applicationsAppTarget = path.join(applicationsDir, "Toby.app");
		await rm(applicationsAppTarget, { recursive: true, force: true });
		await cp(appPath, applicationsAppTarget, { recursive: true });

		// Remove any legacy copy left next to the toby binary by older installers.
		const legacyAppTarget = path.join(
			path.dirname(installTarget),
			"Toby.app",
		);
		await rm(legacyAppTarget, { recursive: true, force: true }).catch(
			() => undefined,
		);
	}

	const {
		pluginSamplePath,
		pluginAzureadPath,
		pluginGmailPath,
		pluginTodoistPath,
		pluginSlackPath,
		pluginJiraPath,
		pluginWebsearchPath,
		pluginApplecalendarPath,
		pluginMacosPath,
		pluginWhisperPath,
	} = getStagingPaths();
	options?.onProgress?.({ phase: "installing", detail: "plugins" });
	await yieldToEventLoop();
	await installStagedPluginBinary(pluginSamplePath, "toby-plugin-sample");
	await installStagedPluginBinary(pluginAzureadPath, "toby-plugin-azuread");
	await installStagedPluginBinary(pluginGmailPath, "toby-plugin-gmail");
	await installStagedPluginBinary(pluginTodoistPath, "toby-plugin-todoist");
	await installStagedPluginBinary(pluginSlackPath, "toby-plugin-slack");
	await installStagedPluginBinary(pluginJiraPath, "toby-plugin-jira");
	await installStagedPluginBinary(pluginWebsearchPath, "toby-plugin-websearch");
	await installStagedPluginBinary(
		pluginApplecalendarPath,
		"toby-plugin-applecalendar",
	);
	await installStagedPluginBinary(pluginMacosPath, "toby-plugin-macos");
	await installStagedPluginBinary(pluginWhisperPath, "toby-plugin-whisper");
	await removeDeprecatedPluginBinaries();

	// Migration: older installs placed helper binaries next to `toby` on PATH.
	// Now that helpers live under ~/.toby/helpers, remove the stale siblings so
	// only `toby` remains in the bin directory.
	await removeLegacySiblingHelpers(installTarget, [listenerInstallTarget]);
	await removeOrphanedLegacyMacOSHelper();
	await removeLegacyWhisperCliHelper();

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

	// Restart from the freshly installed binary. process.execPath here is the
	// staging binary, which we just renamed into installTarget, so spawning it
	// would fail with ENOENT.
	const daemonRestart = await restartDaemonIfRunning(60, installTarget);

	try {
		ensureWhisperPluginSetup();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(
			`Note: whisper setup incomplete after upgrade: ${message}\nRun: toby plugins setup whisper\n`,
		);
	}

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
	readonly onProgress?: (progress: UpgradeProgress) => void;
}): Promise<ApplyStagedResult> {
	const download = await downloadRelease(options);
	return applyStagedReleaseDelegated(download.installTarget, {
		onProgress: options.onProgress,
	});
}

async function installStagedPluginBinary(
	stagingPath: string,
	binaryName: string,
): Promise<void> {
	if (!fs.existsSync(stagingPath)) {
		return;
	}
	const pluginsDir = getPluginsDir();
	await mkdir(pluginsDir, { recursive: true });
	const installTarget = path.join(pluginsDir, binaryName);
	const tempDestination = path.join(
		pluginsDir,
		`.${binaryName}-upgrade-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	copyPluginResourceBundlesFromSource(stagingPath);
	await rm(tempDestination, { force: true }).catch(() => undefined);
	await rename(stagingPath, tempDestination);
	await chmodExecutable(tempDestination);
	await rename(tempDestination, installTarget);
}

const REMOVED_PLUGIN_BINARIES = ["toby-plugin-applemail"] as const;

/** Remove plugin binaries retired from release bundles (best-effort). */
export async function removeDeprecatedPluginBinaries(): Promise<void> {
	const pluginsDir = getPluginsDir();
	for (const binaryName of REMOVED_PLUGIN_BINARIES) {
		const pluginPath = path.join(pluginsDir, binaryName);
		if (!fs.existsSync(pluginPath)) {
			continue;
		}
		await rm(pluginPath, { force: true }).catch(() => undefined);
	}
}

const LEGACY_SIBLING_HELPER_NAMES = ["toby-listener", "toby-macos"] as const;

/** Remove the standalone whisper-cli helper superseded by embedded whisper.cpp. */
export async function removeLegacyWhisperCliHelper(): Promise<void> {
	const legacyPath = path.join(getHelpersDir(), "whisper-cli");
	if (!fs.existsSync(legacyPath)) {
		return;
	}
	await rm(legacyPath, { force: true }).catch(() => undefined);
}

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
	onProgress?: (progress: UpgradeProgress) => void,
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
				phase: "downloading",
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
				phase: "downloading",
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
	const result = await runCommand("unzip", [
		"-o",
		"-q",
		archivePath,
		"-d",
		destinationDir,
	]);
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
}

function runCommand(
	command: string,
	args: readonly string[],
): Promise<{ status: number; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args);
		let stderr = "";
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("close", (status) => {
			resolve({ status: status ?? 1, stderr });
		});
	});
}

async function yieldToEventLoop(): Promise<void> {
	await new Promise<void>((resolve) => {
		setImmediate(resolve);
	});
}

/** Remove standalone toby-macos helper superseded by toby-plugin-macos. */
export async function removeOrphanedLegacyMacOSHelper(): Promise<void> {
	const legacyPath = path.join(getHelpersDir(), "toby-macos");
	if (!fs.existsSync(legacyPath)) {
		return;
	}
	await rm(legacyPath, { force: true }).catch(() => undefined);
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
