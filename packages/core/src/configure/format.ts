export function formatListenDuration(ms: number | undefined): string {
	if (ms === undefined) return "";
	const totalSeconds = Math.round(ms / 1000);
	const mins = Math.floor(totalSeconds / 60);
	const secs = totalSeconds % 60;
	return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export function formatListenRecordingDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
}

export function listenRecordingTreeLabel(
	startedAt: string | undefined,
	createdAt: string,
	name: string | undefined,
	id: string,
): string {
	const title =
		name?.trim() || formatListenRecordingDate(startedAt || createdAt) || id;
	return title;
}
