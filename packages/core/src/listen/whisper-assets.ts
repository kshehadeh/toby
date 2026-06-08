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
	isModelFileInstalled,
	resolveDefaultWhisperModelPath,
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

export interface EnsureWhisperAssetsOptions {
	readonly forceModel?: boolean;
	readonly onProgress?: (message: string) => void;
}

export interface WhisperAssetStatus {
	readonly modelPath: string;
	readonly modelInstalled: boolean;
}

export interface EnsureWhisperAssetsResult {
	readonly modelPath: string;
}

function progress(
	options: EnsureWhisperAssetsOptions | undefined,
	message: string,
): void {
	options?.onProgress?.(message);
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
	if (isModelFileInstalled(modelPath) && !options?.forceModel) {
		return modelPath;
	}
	if (options?.forceModel && fs.existsSync(modelPath)) {
		await rm(modelPath, { force: true }).catch(() => undefined);
	}
	await downloadWhisperModel(modelPath, options);
	return modelPath;
}

export function getWhisperAssetStatus(): WhisperAssetStatus {
	const modelPath = resolveDefaultWhisperModelPath();
	return {
		modelPath,
		modelInstalled: isModelFileInstalled(modelPath),
	};
}

export async function ensureWhisperTranscriptionAssets(
	options?: EnsureWhisperAssetsOptions,
): Promise<EnsureWhisperAssetsResult> {
	ensureTobyDir();
	await mkdir(getWhisperModelsDir(), { recursive: true });

	const modelPath = await ensureWhisperModel(options);
	if (!isModelFileInstalled(modelPath)) {
		throw new Error(`Whisper model is missing at ${modelPath}.`);
	}

	return { modelPath };
}

export async function verifyWhisperModelReadable(
	modelPath: string,
): Promise<boolean> {
	return isModelFileInstalled(modelPath);
}

export function getResolvedWhisperModelPath(): string {
	return resolveWhisperCppConfig().modelPath;
}
