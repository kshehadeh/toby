import fs from "node:fs";
import { resolveWhisperCppConfig } from "@toby/core/listen/whisper-config";
import {
	ListenCaptureError,
	transcribeWithMacOSAudioHelper,
} from "../macos/audio-capture";
import type { ListenRecordingFiles } from "../types";

export class ListenTranscriptionError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "ListenTranscriptionError";
		this.code = code;
	}
}

export interface TranscribeWithWhisperCppOptions {
	readonly input: string;
	readonly outDir: string;
	readonly helperPath?: string;
	readonly onStatus?: (message: string) => void;
}

function mapHelperError(error: unknown): ListenTranscriptionError {
	if (error instanceof ListenCaptureError) {
		return new ListenTranscriptionError(error.code, error.message);
	}
	if (error instanceof ListenTranscriptionError) {
		return error;
	}
	return new ListenTranscriptionError(
		"transcribe_failed",
		error instanceof Error ? error.message : String(error),
	);
}

export async function transcribeWithWhisperCpp(
	options: TranscribeWithWhisperCppOptions,
): Promise<ListenRecordingFiles> {
	const config = resolveWhisperCppConfig();
	if (!fs.existsSync(config.binaryPath)) {
		throw new ListenTranscriptionError(
			"whisper_missing",
			`whisper-cli not found at ${config.binaryPath}. Run toby whisper setup.`,
		);
	}
	if (!fs.existsSync(config.modelPath)) {
		throw new ListenTranscriptionError(
			"model_missing",
			`Whisper model not found at ${config.modelPath}. Run toby whisper setup.`,
		);
	}
	if (!fs.existsSync(options.input)) {
		throw new ListenTranscriptionError(
			"input_missing",
			`Audio file does not exist: ${options.input}`,
		);
	}

	try {
		return await transcribeWithMacOSAudioHelper({
			input: options.input,
			outDir: options.outDir,
			whisperCli: config.binaryPath,
			model: config.modelPath,
			language: config.language,
			helperPath: options.helperPath,
			onEvent: (event) => {
				if (event.type === "status") {
					options.onStatus?.(event.message);
				}
			},
		});
	} catch (error) {
		throw mapHelperError(error);
	}
}
