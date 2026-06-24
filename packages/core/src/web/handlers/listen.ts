import fs from "node:fs";
import { listenManager } from "../../listen/manager";
import {
	deleteListenRecordingById,
	findListenRecordingById,
	listListenRecordings,
	metadataPath,
	readListenTranscript,
	recordingHasAudio,
	recordingHasTranscript,
	resolveListenRecordingAudioPath,
} from "../../listen/recordings";
import { transcribeWithPlugin } from "../../listen/transcription-plugin";
import type {
	ListenRecordingFiles,
	ListenRecordingMetadata,
} from "../../listen/types";
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
	const audioPath = resolveListenRecordingAudioPath(recording);
	return jsonResponse({
		id: recording.id,
		dir: recording.dir,
		metadata: recording.metadata,
		hasAudio: audioPath !== undefined,
		audioPath,
		hasTranscript: transcript.ok,
		transcript: transcript.ok ? transcript.text : undefined,
		transcriptError: transcript.ok ? undefined : transcript.error,
		segments: transcript.ok ? transcript.segments : undefined,
		warnings: transcript.ok ? transcript.warnings : undefined,
	});
}

export function handleListenRecordingDelete(recordingId: string): Response {
	try {
		if (!deleteListenRecordingById(recordingId)) {
			return errorResponse("Recording not found", 404);
		}
		return jsonResponse({ ok: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 500);
	}
}

export async function handleListenRecordingTranscribe(
	recordingId: string,
	req: Request,
): Promise<Response> {
	const acceptsSse = req.headers.get("accept")?.includes("text/event-stream");
	if (acceptsSse) {
		return handleListenRecordingTranscribeStream(recordingId, req);
	}
	return handleListenRecordingTranscribeJson(recordingId, req);
}

async function handleListenRecordingTranscribeJson(
	recordingId: string,
	req: Request,
): Promise<Response> {
	const body = await readJsonBody<Record<string, unknown>>(req);
	const recordingsDir =
		typeof body?.recordingsDir === "string" ? body.recordingsDir : undefined;
	const recording = findListenRecordingById(recordingId, recordingsDir);
	if (!recording) {
		return errorResponse("Recording not found", 404);
	}
	const input = resolveListenRecordingAudioPath(recording);
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
		return jsonResponse(finalizeTranscription(recording, transcriptFiles));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		writeRecordingError(recording.metadata, recording.dir, message);
		return errorResponse(message, 500);
	}
}

async function handleListenRecordingTranscribeStream(
	recordingId: string,
	req: Request,
): Promise<Response> {
	const body = await readJsonBody<Record<string, unknown>>(req);
	const recordingsDir =
		typeof body?.recordingsDir === "string" ? body.recordingsDir : undefined;
	const recording = findListenRecordingById(recordingId, recordingsDir);
	const sseHeaders: HeadersInit = {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	};
	const encode = (event: string, data: unknown): Uint8Array =>
		new TextEncoder().encode(
			`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
		);

	if (!recording) {
		return errorResponse("Recording not found", 404);
	}
	const input = resolveListenRecordingAudioPath(recording);
	if (!input) {
		const message =
			"Recording has no readable audio file. Expected combined.m4a, mic.wav, or system.wav.";
		writeRecordingError(recording.metadata, recording.dir, message);
		return errorResponse(message, 400);
	}

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(new TextEncoder().encode(": keep-alive\n\n"));
				} catch {
					clearInterval(heartbeat);
				}
			}, 5000);

			try {
				const transcriptFiles = await transcribeWithPlugin({
					input,
					outDir: recording.dir,
					onStatus: (message) => {
						controller.enqueue(encode("status", { message }));
					},
				});
				const detail = finalizeTranscription(recording, transcriptFiles);
				controller.enqueue(encode("done", detail));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				writeRecordingError(recording.metadata, recording.dir, message);
				controller.enqueue(encode("error", { error: message }));
			} finally {
				clearInterval(heartbeat);
				controller.close();
			}
		},
	});

	return new Response(stream, { headers: sseHeaders });
}

function finalizeTranscription(
	recording: ReturnType<typeof findListenRecordingById>,
	transcriptFiles: ListenRecordingFiles,
) {
	if (!recording) {
		throw new Error("Recording not found");
	}
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
	const audioPath = resolveListenRecordingAudioPath({
		...recording,
		metadata: nextMetadata,
	});
	return {
		id: recording.id,
		dir: recording.dir,
		metadata: nextMetadata,
		hasAudio: audioPath !== undefined,
		audioPath,
		hasTranscript: transcript.ok,
		transcript: transcript.ok ? transcript.text : undefined,
		transcriptError: transcript.ok ? undefined : transcript.error,
		segments: transcript.ok ? transcript.segments : undefined,
		warnings: transcript.ok ? transcript.warnings : undefined,
	};
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
