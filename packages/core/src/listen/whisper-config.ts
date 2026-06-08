import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getIntegrationCredential, readCredentials } from "../config/index";

export const DEFAULT_WHISPER_MODEL_FILE = "ggml-base.en.bin";

/** Expected size of ggml-base.en.bin from whisper.cpp models (bytes). */
export const DEFAULT_WHISPER_MODEL_BYTES = 147_951_465;

export const DEFAULT_WHISPER_MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${DEFAULT_WHISPER_MODEL_FILE}`;

export interface ListenWhisperCppConfig {
	/** @deprecated Migrated to whisper plugin credentials. */
	readonly binaryPath?: string;
	readonly modelPath?: string;
	readonly language?: string;
}

export interface ListenConfig {
	/** @deprecated Migrated to whisper plugin credentials; kept for one-time migration. */
	readonly whisperCpp?: ListenWhisperCppConfig;
	readonly transcriptionPlugin?: string;
	readonly transcriptionTimeoutMs?: number;
}

export const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 600_000;

export interface ResolvedWhisperCppConfig {
	readonly modelPath: string;
	readonly language: string;
}

function resolveTobyDir(): string {
	const override = process.env.TOBY_DIR?.trim();
	return override || path.join(os.homedir(), ".toby");
}

function getConfigPath(): string {
	return path.join(resolveTobyDir(), "config.json");
}

export function getWhisperModelsDir(): string {
	return path.join(resolveTobyDir(), "models");
}

export function resolveDefaultWhisperModelPath(): string {
	return path.join(getWhisperModelsDir(), DEFAULT_WHISPER_MODEL_FILE);
}

function envString(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value || undefined;
}

function readListenConfigFromFile(): ListenConfig | undefined {
	const configPath = getConfigPath();
	if (!fs.existsSync(configPath)) return undefined;
	try {
		const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
			listen?: ListenConfig;
		};
		return parsed.listen;
	} catch {
		return undefined;
	}
}

function readWhisperPluginCredential(field: string): string | undefined {
	return getIntegrationCredential(readCredentials(), "whisper", field);
}

function resolveWhisperModelCandidates(): string[] {
	return [
		envString("TOBY_WHISPER_CPP_MODEL"),
		readWhisperPluginCredential("modelPath"),
		readListenConfigFromFile()?.whisperCpp?.modelPath?.trim(),
		resolveDefaultWhisperModelPath(),
	].filter((candidate): candidate is string => Boolean(candidate?.trim()));
}

export function resolveWhisperCppConfig(): ResolvedWhisperCppConfig {
	const listenConfig = readListenConfigFromFile();
	const language =
		envString("TOBY_WHISPER_CPP_LANGUAGE") ??
		readWhisperPluginCredential("language") ??
		listenConfig?.whisperCpp?.language?.trim() ??
		"auto";

	const modelPath = path.resolve(
		expandHome(
			resolveWhisperModelCandidates()[0] ?? resolveDefaultWhisperModelPath(),
		),
	);

	return { modelPath, language };
}

export function expandHome(filePath: string): string {
	if (filePath.startsWith("~/")) {
		return path.join(os.homedir(), filePath.slice(2));
	}
	return filePath;
}

export function isModelFileInstalled(modelPath: string): boolean {
	if (!fs.existsSync(modelPath)) return false;
	try {
		return fs.statSync(modelPath).size >= DEFAULT_WHISPER_MODEL_BYTES * 0.9;
	} catch {
		return false;
	}
}
