import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_WHISPER_MODEL_FILE = "ggml-base.en.bin";

/** Expected size of ggml-base.en.bin from whisper.cpp models (bytes). */
export const DEFAULT_WHISPER_MODEL_BYTES = 147_951_465;

export const DEFAULT_WHISPER_MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${DEFAULT_WHISPER_MODEL_FILE}`;

export interface ListenWhisperCppConfig {
	readonly binaryPath?: string;
	readonly modelPath?: string;
	readonly language?: string;
}

export interface ListenConfig {
	readonly whisperCpp?: ListenWhisperCppConfig;
}

export interface ResolvedWhisperCppConfig {
	readonly binaryPath: string;
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

function getHelpersDir(): string {
	return path.join(resolveTobyDir(), "helpers");
}

export function getWhisperModelsDir(): string {
	return path.join(resolveTobyDir(), "models");
}

export function resolveWhisperCliInstallTarget(): string {
	return path.join(getHelpersDir(), "whisper-cli");
}

export function resolveDefaultWhisperModelPath(): string {
	return path.join(getWhisperModelsDir(), DEFAULT_WHISPER_MODEL_FILE);
}

function envString(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value || undefined;
}

function resolveWhisperBinaryFromPath(): string | undefined {
	const pathEnv = process.env.PATH ?? "";
	for (const dir of pathEnv.split(path.delimiter)) {
		if (!dir) continue;
		const candidate = path.join(dir, "whisper-cli");
		if (fs.existsSync(candidate)) {
			try {
				fs.accessSync(candidate, fs.constants.X_OK);
				return candidate;
			} catch {
				// try next candidate
			}
		}
	}
	return undefined;
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

function resolveWhisperBinaryCandidates(): string[] {
	const homebrewPrefixes =
		os.arch() === "arm64"
			? ["/opt/homebrew/bin/whisper-cli"]
			: ["/usr/local/bin/whisper-cli", "/opt/homebrew/bin/whisper-cli"];
	return [
		envString("TOBY_WHISPER_CPP_BINARY"),
		readListenConfigFromFile()?.whisperCpp?.binaryPath?.trim(),
		resolveWhisperCliInstallTarget(),
		...homebrewPrefixes,
		resolveWhisperBinaryFromPath(),
	].filter((candidate): candidate is string => Boolean(candidate?.trim()));
}

function resolveWhisperModelCandidates(): string[] {
	return [
		envString("TOBY_WHISPER_CPP_MODEL"),
		readListenConfigFromFile()?.whisperCpp?.modelPath?.trim(),
		resolveDefaultWhisperModelPath(),
	].filter((candidate): candidate is string => Boolean(candidate?.trim()));
}

export function resolveWhisperCppConfig(): ResolvedWhisperCppConfig {
	const listenConfig = readListenConfigFromFile();
	const language =
		envString("TOBY_WHISPER_CPP_LANGUAGE") ??
		listenConfig?.whisperCpp?.language?.trim() ??
		"auto";

	for (const binaryPath of resolveWhisperBinaryCandidates()) {
		const resolved = path.resolve(expandHome(binaryPath));
		if (isExecutableFile(resolved)) {
			for (const modelPath of resolveWhisperModelCandidates()) {
				const resolvedModel = path.resolve(expandHome(modelPath));
				if (fs.existsSync(resolvedModel)) {
					return {
						binaryPath: resolved,
						modelPath: resolvedModel,
						language,
					};
				}
			}
			return {
				binaryPath: resolved,
				modelPath: path.resolve(
					expandHome(
						resolveWhisperModelCandidates()[0] ??
							resolveDefaultWhisperModelPath(),
					),
				),
				language,
			};
		}
	}

	const fallbackBinary = path.resolve(
		expandHome(
			resolveWhisperBinaryCandidates()[0] ?? resolveWhisperCliInstallTarget(),
		),
	);
	const fallbackModel = path.resolve(
		expandHome(
			resolveWhisperModelCandidates()[0] ?? resolveDefaultWhisperModelPath(),
		),
	);
	return {
		binaryPath: fallbackBinary,
		modelPath: fallbackModel,
		language,
	};
}

export function expandHome(filePath: string): string {
	if (filePath.startsWith("~/")) {
		return path.join(os.homedir(), filePath.slice(2));
	}
	return filePath;
}

export function isExecutableFile(filePath: string): boolean {
	if (!fs.existsSync(filePath)) return false;
	try {
		fs.accessSync(filePath, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}
