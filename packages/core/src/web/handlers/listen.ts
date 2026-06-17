import fs from "node:fs";
import path from "node:path";
import { listenManager } from "../../listen/manager";
import {
	findListenRecordingById,
	listListenRecordings,
	metadataPath,
	readListenTranscript,
	recordingHasAudio,
	recordingHasTranscript,
} from "../../listen/recordings";
import { transcribeWithPlugin } from "../../listen/transcription-plugin";
import type { ListenRecordingMetadata } from "../../listen/types";
import { errorResponse, jsonResponse, readJsonBody } from "../http-utils";

export function handleListenStatus(): Response {
	return jsonResponse(listenManager.status());
}

export function handleListenStart(): Response {
	try {
		return jsonResponse(listenManager.start());
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const status = /already recording/i.test(message) ? 409 : 500;
		return errorResponse(message, status);
	}
}

export async function handleListenStop(req: Request): Promise<Response> {
	const body = await readJsonBody<Record<string, unknown>>(req);
	if (body === null) {
		return errorResponse("Invalid JSON body", 400);
	}
	try {
		return jsonResponse(await listenManager.stop());
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const status = /no active recording/i.test(message) ? 409 : 500;
		return errorResponse(message, status);
	}
}

export function handleListenRecordingsList(): Response {
	return jsonResponse({
		recordings: listListenRecordings().map((recording) => ({
			id: recording.id,
			dir: recording.dir,
			name: recording.metadata.name,
			description: recording.metadata.description,
			createdAt: recording.metadata.createdAt,
			startedAt: recording.metadata.startedAt,
			stoppedAt: recording.metadata.stoppedAt,
			durationMs: recording.metadata.durationMs,
			sources: recording.metadata.sources,
			hasAudio: recordingHasAudio(recording),
			hasTranscript: recordingHasTranscript(recording),
		})),
	});
}

export function handleListenRecordingDetail(recordingId: string): Response {
	const recording = findListenRecordingById(recordingId);
	if (!recording) {
		return errorResponse("Recording not found", 404);
	}
	const transcript = readListenTranscript(recording.dir, {
		includeSegments: true,
	});
	return jsonResponse({
		id: recording.id,
		dir: recording.dir,
		metadata: recording.metadata,
		hasAudio: recordingHasAudio(recording),
		hasTranscript: transcript.ok,
		transcript: transcript.ok ? transcript.text : undefined,
		transcriptError: transcript.ok ? undefined : transcript.error,
		segments: transcript.ok ? transcript.segments : undefined,
		warnings: transcript.ok ? transcript.warnings : undefined,
	});
}

export async function handleListenRecordingTranscribe(
	recordingId: string,
): Promise<Response> {
	const recording = findListenRecordingById(recordingId);
	if (!recording) {
		return errorResponse("Recording not found", 404);
	}
	const input = resolveTranscriptionInput(recording.dir, recording.metadata.files);
	if (!input) {
		const message =
			"Recording has no readable audio file. Expected combined.m4a, mic.wav, or system.wav.";
		writeRecordingError(recording.metadata, recording.dir, message);
		return errorResponse(message, 400);
	}
	try {
		const transcriptFiles = await transcribeWithPlugin({
			input,
			outDir: recording.dir,
		});
		const nextMetadata: ListenRecordingMetadata = {
			...recording.metadata,
			files: {
				...recording.metadata.files,
				...transcriptFiles,
			},
		};
		fs.writeFileSync(
			metadataPath(recording.dir),
			`${JSON.stringify(nextMetadata, null, 2)}\n`,
		);
		const transcript = readListenTranscript(recording.dir, {
			includeSegments: true,
		});
		return jsonResponse({
			id: recording.id,
			dir: recording.dir,
			metadata: nextMetadata,
			hasAudio: recordingHasAudio({ ...recording, metadata: nextMetadata }),
			hasTranscript: transcript.ok,
			transcript: transcript.ok ? transcript.text : undefined,
			transcriptError: transcript.ok ? undefined : transcript.error,
			segments: transcript.ok ? transcript.segments : undefined,
			warnings: transcript.ok ? transcript.warnings : undefined,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		writeRecordingError(recording.metadata, recording.dir, message);
		return errorResponse(message, 500);
	}
}

function resolveTranscriptionInput(
	recordingDir: string,
	files: ListenRecordingMetadata["files"],
): string | undefined {
	return (
		resolveRecordingFile(recordingDir, files.mic, "mic.wav") ??
		resolveRecordingFile(recordingDir, files.system, "system.wav") ??
		resolveRecordingFile(recordingDir, files.combined, "combined.m4a")
	);
}

function writeRecordingError(
	metadata: ListenRecordingMetadata,
	recordingDir: string,
	message: string,
): void {
	const errors = [...(metadata.errors ?? [])];
	if (!errors.includes(message)) errors.push(message);
	const nextMetadata: ListenRecordingMetadata = {
		...metadata,
		errors,
	};
	fs.writeFileSync(
		metadataPath(recordingDir),
		`${JSON.stringify(nextMetadata, null, 2)}\n`,
	);
}

function resolveRecordingFile(
	recordingDir: string,
	filePath?: string,
	fallbackName?: string,
): string | undefined {
	if (filePath?.trim()) {
		const candidate = path.isAbsolute(filePath)
			? filePath
			: path.join(recordingDir, filePath);
		if (fs.existsSync(candidate)) return candidate;
	}
	if (fallbackName) {
		const fallback = path.join(recordingDir, fallbackName);
		if (fs.existsSync(fallback)) return fallback;
	}
	return undefined;
}
