import { type Tool, tool } from "ai";
import { z } from "zod";
import {
	findListenRecordingById,
	listListenRecordings,
	readListenTranscript,
	recordingHasAudio,
	recordingHasTranscript,
} from "../listen/recordings";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

export function listenChatToolsPromptSection(): string {
	return `
Listen recording tools (saved audio from \`toby listen\` or chat \`/listen\`):
- **listListenRecordings**: List saved recordings with ids, optional names, timestamps, and whether a transcript exists. Call this when the user refers to past recordings, meetings, or listen sessions without a specific id.
- **readTranscript**: Load the transcript text for one recording by exact \`recordingId\` from **listListenRecordings**. Use before summarizing, quoting, or analyzing what was said. Set \`includeSegments=true\` only when timed segments are needed.

Listen recording rules:
- When the user asks about a past recording without an id, call **listListenRecordings** first, then **readTranscript** with the matching id.
- If a recording has no transcript yet, tell the user they can retry with \`toby listen transcribe <recording-folder>\`.
`;
}

export function createListenChatTools(): Record<string, Tool> {
	return {
		listListenRecordings: tool({
			description:
				"List saved listen recordings from ~/.toby/listen/recordings. Returns recording ids, optional names/descriptions, timestamps, duration, and whether transcript/audio files exist. Use when the user refers to past recordings without a specific id.",
			inputSchema: z.object({
				limit: z
					.number()
					.int()
					.min(1)
					.max(MAX_LIST_LIMIT)
					.optional()
					.describe(
						`Maximum recordings to return (default ${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT})`,
					),
			}),
			execute: async ({ limit }) => {
				const capped = Math.min(
					Math.max(1, limit ?? DEFAULT_LIST_LIMIT),
					MAX_LIST_LIMIT,
				);
				const recordings = listListenRecordings().slice(0, capped);
				return {
					ok: true as const,
					recordings: recordings.map((recording) => ({
						id: recording.id,
						...(recording.metadata.name
							? { name: recording.metadata.name }
							: {}),
						...(recording.metadata.description
							? { description: recording.metadata.description }
							: {}),
						startedAt: recording.metadata.startedAt,
						...(recording.metadata.stoppedAt
							? { stoppedAt: recording.metadata.stoppedAt }
							: {}),
						...(recording.metadata.durationMs !== undefined
							? { durationMs: recording.metadata.durationMs }
							: {}),
						hasTranscript: recordingHasTranscript(recording),
						hasAudio: recordingHasAudio(recording),
					})),
				};
			},
		}),
		readTranscript: tool({
			description:
				"Read the transcript for a saved listen recording by exact recordingId. Returns plain text by default; set includeSegments=true for timed segments from transcript.json.",
			inputSchema: z.object({
				recordingId: z
					.string()
					.min(1)
					.describe("Exact recording id from listListenRecordings"),
				includeSegments: z
					.boolean()
					.optional()
					.describe(
						"When true, include timed segments from transcript.json in addition to plain text",
					),
			}),
			execute: async ({ recordingId, includeSegments }) => {
				const recording = findListenRecordingById(recordingId);
				if (!recording) {
					return {
						ok: false as const,
						error: `No listen recording found with id "${recordingId.trim()}". Call listListenRecordings to see available ids.`,
					};
				}

				const transcript = readListenTranscript(recording.dir, {
					includeSegments: includeSegments === true,
				});
				if (!transcript.ok) {
					return {
						ok: false as const,
						error: transcript.error,
						recordingId: recording.id,
						recordingDir: recording.dir,
					};
				}

				return {
					ok: true as const,
					recordingId: recording.id,
					...(recording.metadata.name ? { name: recording.metadata.name } : {}),
					...(recording.metadata.description
						? { description: recording.metadata.description }
						: {}),
					startedAt: recording.metadata.startedAt,
					...(recording.metadata.durationMs !== undefined
						? { durationMs: recording.metadata.durationMs }
						: {}),
					text: transcript.text,
					...(transcript.segments ? { segments: transcript.segments } : {}),
					...(transcript.sourceAudio
						? { sourceAudio: transcript.sourceAudio }
						: {}),
					...(transcript.locale ? { locale: transcript.locale } : {}),
					...(transcript.createdAt
						? { transcriptCreatedAt: transcript.createdAt }
						: {}),
					...(transcript.warnings ? { warnings: transcript.warnings } : {}),
				};
			},
		}),
	};
}
