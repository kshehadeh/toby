import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	getDefaultProvider,
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "../config/index";
import { getModulesWithCapability } from "../integrations/index";
import { mergePluginConfigPatch } from "../integrations/plugins/adapter";
import {
	pluginSetup,
	pluginToolsExecuteAsync,
} from "../integrations/plugins/client";
import type { DiscoveredPlugin } from "../integrations/plugins/protocol";
import {
	findDiscoveredPlugin,
	inspectPluginBinary,
} from "../integrations/plugins/registry";
import type { ListenRecordingFiles } from "./types";
import {
	DEFAULT_TRANSCRIPTION_TIMEOUT_MS,
	type ListenConfig,
	resolveDefaultWhisperModelPath,
} from "./whisper-config";

export const TRANSCRIPTION_TOOL_NAME = "doTranscription";

export class ListenTranscriptionError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "ListenTranscriptionError";
		this.code = code;
	}
}

interface DoTranscriptionResult {
	readonly transcriptPath: string;
	readonly transcriptJsonPath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildPluginEnvelope(pluginName: string): {
	readonly config: Record<string, unknown>;
	readonly state: Record<string, unknown>;
} {
	const creds = readCredentials();
	const config = readConfig();
	const configBlock = creds.integrations?.[pluginName];
	const stateBlock = config.integrations?.[pluginName];
	return {
		config:
			configBlock && typeof configBlock === "object" ? { ...configBlock } : {},
		state:
			stateBlock && typeof stateBlock === "object" ? { ...stateBlock } : {},
	};
}

function listTranscriptionPluginNames(): string[] {
	return getModulesWithCapability("transcription").map((mod) => mod.name);
}

export function resolveTranscriptionPluginName(
	listenConfig?: ListenConfig,
): string | undefined {
	const configured =
		listenConfig?.transcriptionPlugin?.trim() ||
		getDefaultProvider("transcription");
	if (configured) {
		return configured;
	}
	const available = listTranscriptionPluginNames();
	if (available.length === 1) {
		return available[0];
	}
	return undefined;
}

export function resolveTranscriptionPlugin(
	listenConfig?: ListenConfig,
): DiscoveredPlugin | undefined {
	const name = resolveTranscriptionPluginName(listenConfig);
	if (!name) {
		return undefined;
	}
	return findDiscoveredPlugin(name);
}

export function isTranscriptionAvailable(listenConfig?: ListenConfig): boolean {
	return Boolean(resolveTranscriptionPlugin(listenConfig));
}

export function migrateListenWhisperConfig(): void {
	const config = readConfig();
	const listen = config.listen;
	if (!listen?.whisperCpp) {
		return;
	}
	const creds = readCredentials();
	const whisperCreds = { ...(creds.integrations?.whisper ?? {}) };
	let credsChanged = false;
	if (listen.whisperCpp.modelPath?.trim() && !whisperCreds.modelPath) {
		whisperCreds.modelPath = listen.whisperCpp.modelPath.trim();
		credsChanged = true;
	}
	if (listen.whisperCpp.language?.trim() && !whisperCreds.language) {
		whisperCreds.language = listen.whisperCpp.language.trim();
		credsChanged = true;
	}
	if (credsChanged) {
		writeCredentials({
			...creds,
			integrations: {
				...creds.integrations,
				whisper: whisperCreds,
			},
		});
	}
	if (!listen.transcriptionPlugin) {
		writeConfig({
			...config,
			listen: {
				...listen,
				transcriptionPlugin: "whisper",
			},
		});
	}
}

function resolveTranscriptionTimeoutMs(listenConfig?: ListenConfig): number {
	const configured = listenConfig?.transcriptionTimeoutMs;
	if (
		typeof configured === "number" &&
		Number.isFinite(configured) &&
		configured > 0
	) {
		return configured;
	}
	return DEFAULT_TRANSCRIPTION_TIMEOUT_MS;
}

async function copyFileAtomic(
	sourcePath: string,
	destPath: string,
): Promise<void> {
	await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
	const tempPath = path.join(
		path.dirname(destPath),
		`.${path.basename(destPath)}.tmp-${Date.now()}`,
	);
	await fs.promises.copyFile(sourcePath, tempPath);
	await fs.promises.rename(tempPath, destPath);
}

async function removePathBestEffort(targetPath: string): Promise<void> {
	try {
		await fs.promises.rm(targetPath, { force: true, recursive: true });
	} catch {
		// ignore cleanup failures
	}
}

async function runAfconvert(
	inputPath: string,
	outputPath: string,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn("/usr/bin/afconvert", [
			"-f",
			"WAVE",
			"-d",
			"LEI16@16000",
			"-c",
			"1",
			inputPath,
			outputPath,
		]);
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(
				new ListenTranscriptionError(
					"audio_convert_failed",
					stderr.trim() || `afconvert exited with status ${code}`,
				),
			);
		});
	});
}

async function prepareWhisperCompatibleInput(inputPath: string): Promise<{
	readonly inputPath: string;
	readonly cleanupDir?: string;
}> {
	if (path.extname(inputPath).toLowerCase() === ".wav") {
		return { inputPath };
	}
	if (process.platform !== "darwin") {
		return { inputPath };
	}
	const afconvert = "/usr/bin/afconvert";
	if (!fs.existsSync(afconvert)) {
		return { inputPath };
	}
	const cleanupDir = await fs.promises.mkdtemp(
		path.join(os.tmpdir(), "TobyTranscriptionInput-"),
	);
	const outputPath = path.join(cleanupDir, "whisper-input.wav");
	try {
		await runAfconvert(inputPath, outputPath);
		return { inputPath: outputPath, cleanupDir };
	} catch (error) {
		await removePathBestEffort(cleanupDir);
		throw error;
	}
}

function parseDoTranscriptionResult(result: unknown): DoTranscriptionResult {
	if (!isRecord(result)) {
		throw new ListenTranscriptionError(
			"invalid_result",
			"Transcription plugin returned a non-object result.",
		);
	}
	const transcriptPath = stringField(result, "transcriptPath");
	if (!transcriptPath) {
		throw new ListenTranscriptionError(
			"invalid_result",
			"Transcription plugin result is missing transcriptPath.",
		);
	}
	const transcriptJsonPath = stringField(result, "transcriptJsonPath");
	return { transcriptPath, transcriptJsonPath };
}

function missingPluginMessage(): string {
	const available = listTranscriptionPluginNames();
	if (available.length === 0) {
		return "No transcription plugin is installed. Run `toby plugins install` or upgrade Toby to install toby-plugin-whisper.";
	}
	return `No transcription plugin selected. Configure Listen → Transcription provider (${available.join(", ")} available).`;
}

export async function transcribeWithPlugin(options: {
	readonly input: string;
	readonly outDir: string;
	readonly onStatus?: (message: string) => void;
}): Promise<ListenRecordingFiles> {
	migrateListenWhisperConfig();
	const config = readConfig();
	const listenConfig = config.listen;
	const discovered = resolveTranscriptionPlugin(listenConfig);
	if (!discovered) {
		throw new ListenTranscriptionError(
			"plugin_missing",
			missingPluginMessage(),
		);
	}

	const inputPath = path.resolve(options.input);
	if (!fs.existsSync(inputPath)) {
		throw new ListenTranscriptionError(
			"input_missing",
			`Audio file does not exist: ${inputPath}`,
		);
	}

	const pluginName = discovered.binaryName.replace(/^toby-plugin-/, "");
	const inspected = inspectPluginBinary(discovered);
	if ("error" in inspected) {
		throw new ListenTranscriptionError("plugin_missing", inspected.error);
	}
	if (!inspected.capabilities.includes("transcription")) {
		throw new ListenTranscriptionError(
			"plugin_missing",
			`Plugin "${pluginName}" is not a transcription provider.`,
		);
	}

	const preparedInput = await prepareWhisperCompatibleInput(inputPath);
	try {
		options.onStatus?.("Transcribing recording…");
		const envelope = buildPluginEnvelope(pluginName);
		const execResult = await pluginToolsExecuteAsync(
			discovered.binaryPath,
			{
				tool: TRANSCRIPTION_TOOL_NAME,
				input: { audioFilePath: preparedInput.inputPath },
				config: envelope.config,
				state: envelope.state,
				dryRun: false,
			},
			{ timeoutMs: resolveTranscriptionTimeoutMs(listenConfig) },
		);

		if (!execResult.ok) {
			const code =
				execResult.code === "spawn_error" &&
				execResult.error.includes("ETIMEDOUT")
					? "transcription_timeout"
					: "transcribe_failed";
			throw new ListenTranscriptionError(
				code,
				execResult.error || "Transcription plugin invocation failed.",
			);
		}
		if (!execResult.data.ok) {
			throw new ListenTranscriptionError(
				"transcribe_failed",
				execResult.data.error ?? "Transcription plugin returned ok:false.",
			);
		}

		const parsed = parseDoTranscriptionResult(execResult.data.result);
		if (!fs.existsSync(parsed.transcriptPath)) {
			throw new ListenTranscriptionError(
				"invalid_result",
				`Transcription plugin returned missing transcript file: ${parsed.transcriptPath}`,
			);
		}

		const outDir = path.resolve(options.outDir);
		await fs.promises.mkdir(outDir, { recursive: true });
		const transcriptDest = path.join(outDir, "transcript.txt");
		await copyFileAtomic(parsed.transcriptPath, transcriptDest);

		const cleanupPaths = [parsed.transcriptPath];
		let hasTranscriptJson = false;

		if (parsed.transcriptJsonPath && fs.existsSync(parsed.transcriptJsonPath)) {
			const jsonDest = path.join(outDir, "transcript.json");
			await copyFileAtomic(parsed.transcriptJsonPath, jsonDest);
			hasTranscriptJson = true;
			cleanupPaths.push(parsed.transcriptJsonPath);
		}

		for (const cleanupPath of cleanupPaths) {
			await removePathBestEffort(cleanupPath);
			const parentDir = path.dirname(cleanupPath);
			if (parentDir.includes("TobyTranscription-")) {
				await removePathBestEffort(parentDir);
			}
		}

		return {
			transcript: "transcript.txt",
			...(hasTranscriptJson ? { transcriptJson: "transcript.json" } : {}),
		};
	} finally {
		if (preparedInput.cleanupDir) {
			await removePathBestEffort(preparedInput.cleanupDir);
		}
	}
}

export interface EnsureWhisperPluginSetupOptions {
	readonly forceModel?: boolean;
}

export function ensureWhisperPluginSetup(
	options: EnsureWhisperPluginSetupOptions = {},
): void {
	const discovered = findDiscoveredPlugin("whisper");
	if (!discovered) {
		throw new ListenTranscriptionError(
			"plugin_missing",
			"toby-plugin-whisper is not installed.",
		);
	}
	const setupResult = pluginSetup(
		discovered.binaryPath,
		{
			config: {
				modelInstallTarget: resolveDefaultWhisperModelPath(),
				...(options.forceModel ? { forceModel: true } : {}),
			},
			state: {},
		},
		{ timeoutMs: DEFAULT_TRANSCRIPTION_TIMEOUT_MS },
	);
	if (!setupResult.ok) {
		throw new ListenTranscriptionError(
			"setup_failed",
			setupResult.error || "Whisper plugin setup failed.",
		);
	}
	if (!setupResult.data.ok) {
		throw new ListenTranscriptionError(
			"setup_failed",
			setupResult.data.reason ??
				setupResult.data.error ??
				"Whisper plugin setup returned ok:false.",
		);
	}
	mergePluginConfigPatch("whisper", setupResult.data.config);
}
