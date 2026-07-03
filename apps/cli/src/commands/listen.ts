import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { transcribeRecordingViaDaemon } from "../listen/daemon-transcribe";
import type { AudioHelperEvent } from "../listen/macos/audio-capture";
import { combineWithMacOSAudioHelper } from "../listen/macos/audio-capture";
import { metadataPath } from "../listen/session-controller";
import type {
	ListenRecordingFiles,
	ListenRecordingMetadata,
} from "../listen/types";
import { runAppLaunchCommand } from "./app";

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
	const recordingId = path.basename(recordingDir);
	const recordingsDir = path.dirname(recordingDir);
	const result = await transcribeRecordingViaDaemon(recordingId, recordingsDir);
	if (!result.ok) {
		throw new Error(result.error);
	}
	const updatedMetadata = readRecordingMetadata(recordingDir);
	const files: ListenRecordingFiles = {
		...combinedFiles,
		...(updatedMetadata?.files.transcript
			? { transcript: updatedMetadata.files.transcript }
			: {}),
		...(updatedMetadata?.files.transcriptJson
			? { transcriptJson: updatedMetadata.files.transcriptJson }
			: {}),
	};
	return files;
}

export function registerListenCommand(program: Command): void {
	const listen = program
		.command("listen")
		.description("Open native app recording controls")
		.action(() => {
			runAppLaunchCommand("Recordings");
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
