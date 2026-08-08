import fs from "node:fs";
import { listenManager } from "../../listen/manager";
import {
	clearListenSummary,
	deleteListenRecordingById,
	findListenRecordingById,
	listListenRecordings,
	metadataPath,
	readListenSummary,
	readListenTranscript,
	recordingHasAudio,
	recordingHasSummary,
	recordingHasTranscript,
	resolveListenRecordingAudioPath,
	resolveListenRecordingCombinedPath,
	resolveListenRecordingMicPath,
	resolveListenRecordingSystemPath,
	writeListenSummary,
} from "../../listen/recordings";
import { updateListenRecordingMetadata } from "../../listen/session-controller";
import { summarizeRecordingTranscript } from "../../listen/summarizer";
import { ListenTranscriptionError } from "../../listen/transcription-errors";
import { transcribeWithModel } from "../../listen/transcription-model";
import { TRANSCRIPTION_NOT_CONFIGURED_CODE } from "../../listen/transcription-model";
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

function recordingDetailPayload(
	recording: NonNullable<ReturnType<typeof findListenRecordingById>>,
) {
	const transcript = readListenTranscript(recording.dir, {
		includeSegments: true,
	});
	const summary = readListenSummary(recording.dir);
	const audioPath = resolveListenRecordingAudioPath(recording);
	const combinedPath = resolveListenRecordingCombinedPath(recording);
	const micPath = resolveListenRecordingMicPath(recording);
	const systemPath = resolveListenRecordingSystemPath(recording);
	return {
		id: recording.id,
		dir: recording.dir,
		metadata: recording.metadata,
		hasAudio: audioPath !== undefined,
		audioPath,
		combinedPath,
		micPath,
		systemPath,
		hasTranscript: transcript.ok,
		transcript: transcript.ok ? transcript.text : undefined,
		transcriptError: transcript.ok ? undefined : transcript.error,
		segments: transcript.ok ? transcript.segments : undefined,
		warnings: transcript.ok ? transcript.warnings : undefined,
		hasSummary: summary.ok,
		summary: summary.ok ? summary.text : undefined,
		summaryMeta: summary.ok
			? (summary.meta ?? recording.metadata.summary)
			: undefined,
	};
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
			hasSummary: recordingHasSummary(recording),
		})),
	});
}

export function handleListenRecordingDetail(recordingId: string): Response {
	const recording = findListenRecordingById(recordingId);
	if (!recording) {
		return errorResponse("Recording not found", 404);
	}
	return jsonResponse(recordingDetailPayload(recording));
}

export async function handleListenRecordingPatch(
	recordingId: string,
	req: Request,
): Promise<Response> {
	const recording = findListenRecordingById(recordingId);
	if (!recording) {
		return errorResponse("Recording not found", 404);
	}
	const body = await readJsonBody<{
		readonly name?: string;
		readonly description?: string;
		readonly chatSessionId?: string | null;
	}>(req);
	if (body === null) {
		return errorResponse("Invalid JSON body", 400);
	}
	const patch: {
		name?: string;
		description?: string;
		chatSessionId?: string | null;
	} = {};
	if (typeof body.name === "string") {
		patch.name = body.name.trim();
	}
	if (typeof body.description === "string") {
		patch.description = body.description.trim();
	}
	if (body.chatSessionId !== undefined) {
		patch.chatSessionId =
			typeof body.chatSessionId === "string"
				? body.chatSessionId.trim() || null
				: null;
	}
	if (
		patch.name === undefined &&
		patch.description === undefined &&
		patch.chatSessionId === undefined
	) {
		return errorResponse(
			"Body must include 'name', 'description', or 'chatSessionId' field",
			400,
		);
	}
	try {
		const updated = updateListenRecordingMetadata(recording, patch);
		return jsonResponse(recordingDetailPayload(updated));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 500);
	}
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
		const transcriptFiles = await transcribeWithModel({
			input,
			outDir: recording.dir,
		});
		return jsonResponse(finalizeTranscription(recording, transcriptFiles));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (
			error instanceof ListenTranscriptionError &&
			error.code === TRANSCRIPTION_NOT_CONFIGURED_CODE
		) {
			writeRecordingError(recording.metadata, recording.dir, message);
			return jsonResponse(
				{ ok: false, notConfigured: true, error: message },
				200,
			);
		}
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
				const transcriptFiles = await transcribeWithModel({
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
				if (
					error instanceof ListenTranscriptionError &&
					error.code === TRANSCRIPTION_NOT_CONFIGURED_CODE
				) {
					controller.enqueue(
						encode("error", { error: message, notConfigured: true }),
					);
				} else {
					controller.enqueue(encode("error", { error: message }));
				}
			} finally {
				clearInterval(heartbeat);
				controller.close();
			}
		},
	});

	return new Response(stream, { headers: sseHeaders });
}

export async function handleListenRecordingSummarize(
	recordingId: string,
): Promise<Response> {
	const recording = findListenRecordingById(recordingId);
	if (!recording) {
		return errorResponse("Recording not found", 404);
	}
	const transcript = readListenTranscript(recording.dir);
	if (!transcript.ok) {
		return errorResponse(
			transcript.error ||
				"No transcript is available for this recording. Transcribe it first.",
			400,
		);
	}
	try {
		const result = await summarizeRecordingTranscript({
			transcript: transcript.text,
			recordingName: recording.metadata.name,
			durationMs: recording.metadata.durationMs,
		});
		const updated = writeListenSummary(recording, {
			text: result.text,
			personaName: result.personaName,
			createdAt: result.createdAt,
		});
		return jsonResponse(recordingDetailPayload(updated));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		writeRecordingError(recording.metadata, recording.dir, message);
		return errorResponse(message, 500);
	}
}

function finalizeTranscription(
	recording: ReturnType<typeof findListenRecordingById>,
	transcriptFiles: ListenRecordingFiles,
) {
	if (!recording) {
		throw new Error("Recording not found");
	}
	// Drop any prior AI summary so it cannot outlive a new transcript.
	const cleared = clearListenSummary(recording);
	// Drop prior metadata errors (e.g. a failed earlier attempt) so the
	// Recordings inspector does not keep showing stale failures after success.
	const { errors: _staleErrors, ...metaWithoutErrors } = cleared.metadata;
	const nextMetadata: ListenRecordingMetadata = {
		...metaWithoutErrors,
		files: {
			...cleared.metadata.files,
			...transcriptFiles,
		},
	};
	fs.writeFileSync(
		metadataPath(cleared.dir),
		`${JSON.stringify(nextMetadata, null, 2)}\n`,
	);
	return recordingDetailPayload({
		...cleared,
		metadata: nextMetadata,
	});
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
