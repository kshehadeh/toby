import { daemonLog } from "../logging/daemon-log";
import {
	type ListenRecordingSummary,
	readListenTranscript,
	writeListenSummary,
} from "./recordings";
import {
	updateListenRecordingMetadata,
	writeListenMetadata,
} from "./session-controller";
import {
	type GenerateTitleFromSummaryParams,
	type GenerateTitleResult,
	type SummarizeRecordingParams,
	type SummarizeRecordingResult,
	generateTitleFromSummary,
	summarizeRecordingTranscript,
} from "./summarizer";
import type { ListenRecordingMetadata } from "./types";

export interface AutoSummarizeListenRecordingDeps {
	readonly summarize?: (
		params: SummarizeRecordingParams,
	) => Promise<SummarizeRecordingResult>;
	readonly generateTitle?: (
		params: GenerateTitleFromSummaryParams,
	) => Promise<GenerateTitleResult>;
	readonly onStatus?: (message: string) => void;
}

/**
 * After a transcript exists, write `summary.md` and, when the recording has no
 * name, replace the timestamp sidebar title with a short AI title.
 *
 * Toby.app does not stop through `ListenManager.stop()`. It saves in-process,
 * then `POST`s `/api/listen/recordings/:id/transcribe` (SSE, with
 * `reuseLiveTranscript: true`). This helper is what runs at that point, and
 * also after helper-backed `ListenManager.stop()` transcription.
 *
 * Failures are recorded on `metadata.errors` and do not reject. A name the
 * user already set is left alone. The manual Summarize endpoint does not call
 * this, so re-summarizing does not rename the recording.
 */
export async function autoSummarizeListenRecording(
	recording: ListenRecordingSummary,
	deps: AutoSummarizeListenRecordingDeps = {},
): Promise<ListenRecordingSummary> {
	const transcript = readListenTranscript(recording.dir);
	if (!transcript.ok) return recording;

	const summarize = deps.summarize ?? summarizeRecordingTranscript;
	const generateTitle = deps.generateTitle ?? generateTitleFromSummary;

	deps.onStatus?.("Summarizing recording…");
	let summarized: ListenRecordingSummary;
	let summaryText: string;
	try {
		const summaryResult = await summarize({
			transcript: transcript.text,
			recordingName: recording.metadata.name,
			durationMs: recording.metadata.durationMs,
		});
		summaryText = summaryResult.text;
		summarized = writeListenSummary(recording, {
			text: summaryResult.text,
			personaName: summaryResult.personaName,
			createdAt: summaryResult.createdAt,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return appendRecordingError(
			recording,
			`Auto-summarization failed: ${message}`,
		);
	}

	if (summarized.metadata.name?.trim()) {
		daemonLog("info", "general", "listen_auto_summary", {
			recordingId: recording.id,
			titled: false,
		});
		return summarized;
	}

	deps.onStatus?.("Naming recording…");
	try {
		const titleResult = await generateTitle({ summary: summaryText });
		const title = titleResult.title.trim();
		if (!title) {
			return appendRecordingError(
				summarized,
				"Title generation failed: Model returned an empty title.",
			);
		}
		const named = updateListenRecordingMetadata(summarized, { name: title });
		daemonLog("info", "general", "listen_auto_summary", {
			recordingId: recording.id,
			titled: true,
		});
		return named;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return appendRecordingError(
			summarized,
			`Title generation failed: ${message}`,
		);
	}
}

function appendRecordingError(
	recording: ListenRecordingSummary,
	message: string,
): ListenRecordingSummary {
	const errors = [...(recording.metadata.errors ?? [])];
	if (!errors.includes(message)) errors.push(message);
	const next: ListenRecordingMetadata = {
		...recording.metadata,
		errors,
	};
	writeListenMetadata(recording.dir, next);
	daemonLog("warn", "general", "listen_auto_summary_failed", {
		recordingId: recording.id,
		error: message,
	});
	return {
		...recording,
		metadata: next,
	};
}
