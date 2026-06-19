import fs from "node:fs";
import path from "node:path";
import { transcribeWithPlugin } from "@toby/core/listen/transcription-plugin";
import type { Command } from "commander";
import type { AudioHelperEvent } from "../listen/macos/audio-capture";
import { combineWithMacOSAudioHelper } from "../listen/macos/audio-capture";
import {
	metadataPath,
	writeListenMetadata,
} from "../listen/session-controller";
import type {
	ListenRecordingFiles,
	ListenRecordingMetadata,
	ListenSourceSelection,
} from "../listen/types";
import { runConfigureUI } from "../ui/configure/App";
import { createConfigureSession } from "../ui/configure/session";

interface ListenCommandOptions {
	readonly micOnly?: boolean;
	readonly systemOnly?: boolean;
	readonly outDir?: string;
}

function resolveSources(options: ListenCommandOptions): ListenSourceSelection {
	if (options.micOnly && options.systemOnly) {
		throw new Error("Use only one of --mic-only or --system-only.");
	}
	if (options.micOnly) {
		return { mic: true, system: false };
	}
	if (options.systemOnly) {
		return { mic: false, system: true };
	}
	return { mic: true, system: true };
}

function resolveRecordingPath(
	recordingDir: string,
	filePath?: string,
): string | null {
	if (!filePath) return null;
	const resolved = path.isAbsolute(filePath)
		? filePath
		: path.join(recordingDir, filePath);
	return fs.existsSync(resolved) ? resolved : null;
}

function readRecordingMetadata(
	recordingDir: string,
): ListenRecordingMetadata | null {
	const file = metadataPath(recordingDir);
	if (!fs.existsSync(file)) return null;
	return JSON.parse(fs.readFileSync(file, "utf8")) as ListenRecordingMetadata;
}

function resolveSourceAudioPath(
	recordingDir: string,
	source: "mic" | "system",
	metadata?: ListenRecordingMetadata | null,
): string | undefined {
	const fromMetadata = resolveRecordingPath(
		recordingDir,
		metadata?.files[source],
	);
	if (fromMetadata) return fromMetadata;
	const fallback = path.join(recordingDir, `${source}.wav`);
	return fs.existsSync(fallback) ? fallback : undefined;
}

export function resolveTranscriptionAudioInput(
	recordingDir: string,
	metadata: ListenRecordingMetadata | null = readRecordingMetadata(
		recordingDir,
	),
): string {
	const fromMetadata = resolveRecordingPath(
		recordingDir,
		metadata?.files.combined,
	);
	if (fromMetadata) return fromMetadata;
	const fallback = path.join(recordingDir, "combined.m4a");
	if (fs.existsSync(fallback)) return fallback;
	throw new Error(`No combined audio file found in ${recordingDir}.`);
}

async function resolveOrCreateTranscriptionAudioInput(params: {
	readonly recordingDir: string;
	readonly metadata: ListenRecordingMetadata | null;
	readonly onEvent?: (event: AudioHelperEvent) => void;
}): Promise<ListenRecordingFiles> {
	const fromMetadata = resolveRecordingPath(
		params.recordingDir,
		params.metadata?.files.combined,
	);
	if (fromMetadata) return { combined: fromMetadata };

	const mic = resolveSourceAudioPath(
		params.recordingDir,
		"mic",
		params.metadata,
	);
	const system = resolveSourceAudioPath(
		params.recordingDir,
		"system",
		params.metadata,
	);
	if (mic || system) {
		return combineWithMacOSAudioHelper({
			outDir: params.recordingDir,
			mic,
			system,
			onEvent: params.onEvent,
		});
	}

	return {
		combined: resolveTranscriptionAudioInput(
			params.recordingDir,
			params.metadata,
		),
	};
}

export function applyTranscriptFilesToMetadata(
	metadata: ListenRecordingMetadata,
	files: ListenRecordingFiles,
): ListenRecordingMetadata {
	return {
		...metadata,
		files: {
			...metadata.files,
			...files,
		},
	};
}

async function transcribeListenRecordingFolder(params: {
	readonly recordingDir: string;
}): Promise<ListenRecordingFiles> {
	const recordingDir = path.resolve(params.recordingDir);
	if (
		!fs.existsSync(recordingDir) ||
		!fs.statSync(recordingDir).isDirectory()
	) {
		throw new Error(`Recording folder does not exist: ${recordingDir}`);
	}
	const metadata = readRecordingMetadata(recordingDir);
	const onEvent = (event: AudioHelperEvent) => {
		if (event.type === "status" && event.message) {
			console.log(event.message);
		}
	};
	const combinedFiles = await resolveOrCreateTranscriptionAudioInput({
		recordingDir,
		metadata,
		onEvent,
	});
	if (!combinedFiles.combined) {
		throw new Error(`No combined audio file found in ${recordingDir}.`);
	}
	const files = await transcribeWithPlugin({
		input: combinedFiles.combined,
		outDir: recordingDir,
		onStatus: (message) => {
			onEvent({ type: "status", message });
			console.log(message);
		},
	});
	if (metadata) {
		writeListenMetadata(
			recordingDir,
			applyTranscriptFilesToMetadata(metadata, { ...combinedFiles, ...files }),
		);
	}
	return { ...combinedFiles, ...files };
}

export function registerListenCommand(program: Command): void {
	const listen = program
		.command("listen")
		.description(
			"Record microphone and/or system audio (opens Configuration → Listen)",
		)
		.option("--mic-only", "Record only microphone input")
		.option("--system-only", "Record only computer/system output audio")
		.option(
			"--out-dir <path>",
			"Directory for recordings (defaults to ~/.toby/listen/recordings)",
		)
		.action((options: ListenCommandOptions) => {
			const listenOptions = {
				sources: resolveSources(options),
				recordingsDir: options.outDir,
			};
			const session = createConfigureSession({ listenOptions });
			runConfigureUI(
				session.initialTree,
				session.initialValues,
				session.onSave,
				session.refreshTree,
				session.callbacks,
				{
					initialPath: ["root", "listen", "listen._start"],
					listenOptions,
				},
			);
		});

	listen
		.command("transcribe <folder>")
		.description("Transcribe a saved listen recording folder")
		.action(async (folder: string) => {
			const files = await transcribeListenRecordingFolder({
				recordingDir: folder,
			});
			if (files.transcript) {
				console.log(`Transcript saved to ${files.transcript}`);
			}
			if (files.transcriptJson) {
				console.log(`Transcript JSON saved to ${files.transcriptJson}`);
			}
		});
}
