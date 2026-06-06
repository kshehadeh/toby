import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	DEFAULT_WHISPER_MODEL_BYTES,
	DEFAULT_WHISPER_MODEL_FILE,
	DEFAULT_WHISPER_MODEL_URL,
	expandHome,
	getWhisperModelsDir,
	isExecutableFile,
	resolveDefaultWhisperModelPath,
	resolveWhisperCliInstallTarget,
	resolveWhisperCppConfig,
} from "./whisper-config";

function resolveTobyDir(): string {
	return process.env.TOBY_DIR?.trim() || path.join(os.homedir(), ".toby");
}

function ensureTobyDir(): void {
	const dir = resolveTobyDir();
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function getHelpersDir(): string {
	return path.join(resolveTobyDir(), "helpers");
}

export interface EnsureWhisperAssetsOptions {
	readonly stagedWhisperCliPath?: string;
	readonly forceModel?: boolean;
	readonly onProgress?: (message: string) => void;
}

export interface WhisperAssetStatus {
	readonly whisperCliPath: string;
	readonly modelPath: string;
	readonly whisperCliInstalled: boolean;
	readonly modelInstalled: boolean;
}

export interface EnsureWhisperAssetsResult {
	readonly whisperCliPath: string;
	readonly modelPath: string;
}

function progress(
	options: EnsureWhisperAssetsOptions | undefined,
	message: string,
): void {
	options?.onProgress?.(message);
}

async function chmodExecutable(filePath: string): Promise<void> {
	const result = spawnSync("chmod", ["+x", filePath], { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(
			`Failed to mark ${filePath} executable: ${result.stderr || "unknown error"}`,
		);
	}
}

async function installStagedExecutable(
	sourcePath: string,
	destinationPath: string,
): Promise<void> {
	await mkdir(path.dirname(destinationPath), { recursive: true });
	const tempDestination = path.join(
		path.dirname(destinationPath),
		`.toby-whisper-upgrade-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	await rm(tempDestination, { force: true }).catch(() => undefined);
	await rename(sourcePath, tempDestination);
	await chmodExecutable(tempDestination);
	await rename(tempDestination, destinationPath);
}

async function ensureWhisperCliBinary(
	options?: EnsureWhisperAssetsOptions,
): Promise<string> {
	ensureTobyDir();
	const installTarget = resolveWhisperCliInstallTarget();
	const stagedPath = options?.stagedWhisperCliPath?.trim();

	if (stagedPath && fs.existsSync(stagedPath)) {
		progress(options, "Installing whisper-cli…");
		await installStagedExecutable(stagedPath, installTarget);
		return installTarget;
	}

	if (isExecutableFile(installTarget)) {
		return installTarget;
	}

	const resolved = resolveWhisperCppConfig();
	if (isExecutableFile(resolved.binaryPath)) {
		return resolved.binaryPath;
	}

	throw new Error(
		[
			"whisper-cli not found.",
			`Expected ${installTarget} or set TOBY_WHISPER_CPP_BINARY.`,
			"Run toby whisper setup after install/upgrade, or install via Homebrew (whisper-cpp).",
		].join(" "),
	);
}

async function downloadWhisperModel(
	modelPath: string,
	options?: EnsureWhisperAssetsOptions,
): Promise<void> {
	await mkdir(path.dirname(modelPath), { recursive: true });
	const tempPath = `${modelPath}.download-${Date.now()}`;
	progress(
		options,
		`Downloading ${DEFAULT_WHISPER_MODEL_FILE} (~${Math.round(DEFAULT_WHISPER_MODEL_BYTES / (1024 * 1024))} MB)…`,
	);

	const response = await fetch(DEFAULT_WHISPER_MODEL_URL);
	if (!response.ok) {
		throw new Error(
			`Model download failed (${response.status} ${response.statusText}).`,
		);
	}
	if (!response.body) {
		const buffer = Buffer.from(await response.arrayBuffer());
		await writeFile(tempPath, buffer);
	} else {
		const reader = response.body.getReader();
		const chunks: Buffer[] = [];
		let bytesReceived = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			const chunk = Buffer.from(value);
			chunks.push(chunk);
			bytesReceived += chunk.length;
			if (bytesReceived % (10 * 1024 * 1024) < chunk.length) {
				progress(
					options,
					`Downloading ${DEFAULT_WHISPER_MODEL_FILE}… ${Math.round(bytesReceived / (1024 * 1024))} MB`,
				);
			}
		}
		await writeFile(tempPath, Buffer.concat(chunks));
	}

	const stat = fs.statSync(tempPath);
	if (stat.size < DEFAULT_WHISPER_MODEL_BYTES * 0.9) {
		await rm(tempPath, { force: true }).catch(() => undefined);
		throw new Error(
			`Downloaded model looks too small (${stat.size} bytes). Try again with toby whisper setup --force.`,
		);
	}

	await rename(tempPath, modelPath);
}

async function ensureWhisperModel(
	options?: EnsureWhisperAssetsOptions,
): Promise<string> {
	const modelPath = path.resolve(expandHome(resolveDefaultWhisperModelPath()));
	if (
		fs.existsSync(modelPath) &&
		!options?.forceModel &&
		fs.statSync(modelPath).size >= DEFAULT_WHISPER_MODEL_BYTES * 0.9
	) {
		return modelPath;
	}
	if (options?.forceModel && fs.existsSync(modelPath)) {
		await rm(modelPath, { force: true }).catch(() => undefined);
	}
	await downloadWhisperModel(modelPath, options);
	return modelPath;
}

export function getWhisperAssetStatus(): WhisperAssetStatus {
	const whisperCliPath = resolveWhisperCliInstallTarget();
	const modelPath = resolveDefaultWhisperModelPath();
	const installedBinary = isExecutableFile(whisperCliPath)
		? whisperCliPath
		: resolveWhisperCppConfig().binaryPath;
	return {
		whisperCliPath: installedBinary,
		modelPath,
		whisperCliInstalled: isExecutableFile(installedBinary),
		modelInstalled:
			fs.existsSync(modelPath) &&
			fs.statSync(modelPath).size >= DEFAULT_WHISPER_MODEL_BYTES * 0.9,
	};
}

export async function ensureWhisperTranscriptionAssets(
	options?: EnsureWhisperAssetsOptions,
): Promise<EnsureWhisperAssetsResult> {
	ensureTobyDir();
	await mkdir(getHelpersDir(), { recursive: true });
	await mkdir(getWhisperModelsDir(), { recursive: true });

	const whisperCliPath = await ensureWhisperCliBinary(options);
	const modelPath = await ensureWhisperModel(options);

	if (!isExecutableFile(whisperCliPath)) {
		throw new Error(`whisper-cli is not executable at ${whisperCliPath}.`);
	}

	return { whisperCliPath, modelPath };
}

export async function verifyWhisperModelReadable(
	modelPath: string,
): Promise<boolean> {
	try {
		const stat = fs.statSync(modelPath);
		return stat.size >= DEFAULT_WHISPER_MODEL_BYTES * 0.9;
	} catch {
		return false;
	}
}
