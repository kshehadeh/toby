import {
	type ListenRecordingSummary,
	listListenRecordings,
} from "../../listen/session-controller";

export function seedListenRecordingValues(
	values: Record<string, string>,
	recordingsDir?: string,
): void {
	for (const key of Object.keys(values)) {
		if (key.startsWith("listen.recordings.")) {
			delete values[key];
		}
	}
	for (const recording of listListenRecordings(recordingsDir)) {
		values[`listen.recordings.${recording.id}.name`] =
			recording.metadata.name ?? "";
		values[`listen.recordings.${recording.id}.description`] =
			recording.metadata.description ?? "";
	}
}

export function findListenRecordingById(
	recordingId: string,
	recordingsDir?: string,
): ListenRecordingSummary | null {
	return (
		listListenRecordings(recordingsDir).find((rec) => rec.id === recordingId) ??
		null
	);
}

export function parseListenRecordingIdFromKey(key: string): string | null {
	const match =
		/^listen\.recordings\.(.+)\.(?:name|description|_open|_delete)$/.exec(key);
	return match?.[1] ?? null;
}
