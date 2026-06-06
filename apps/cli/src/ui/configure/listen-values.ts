import { seedListenRecordingValues as seedCoreListenRecordingValues } from "@toby/core/configure/persistence";
import {
	type ListenRecordingSummary,
	listListenRecordings,
} from "../../listen/session-controller";

export function seedListenRecordingValues(
	values: Record<string, string>,
	recordingsDir?: string,
): void {
	seedCoreListenRecordingValues(
		values,
		listListenRecordings(recordingsDir),
	);
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
