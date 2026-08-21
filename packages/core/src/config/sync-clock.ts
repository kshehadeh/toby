export interface SyncClock {
	lamport: number;
	utc: string;
	deviceId: string;
	deviceName: string;
}

/**
 * Compare two clocks. Positive if `a` wins, negative if `b` wins, 0 if equal.
 * Order: lamport, then UTC timestamp, then deviceId lexicographic.
 */
export function compareSyncClock(a: SyncClock, b: SyncClock): number {
	if (a.lamport !== b.lamport) {
		return a.lamport - b.lamport;
	}
	if (a.utc !== b.utc) {
		return a.utc < b.utc ? -1 : 1;
	}
	if (a.deviceId !== b.deviceId) {
		return a.deviceId < b.deviceId ? -1 : 1;
	}
	return 0;
}

export function nextSyncClock(
	prevLamport: number,
	deviceId: string,
	deviceName: string,
	now = new Date(),
): SyncClock {
	const utc = now.toISOString();
	return {
		lamport: Math.max(0, prevLamport) + 1,
		utc,
		deviceId,
		deviceName,
	};
}

export function isSyncClock(value: unknown): value is SyncClock {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record.lamport === "number" &&
		Number.isFinite(record.lamport) &&
		typeof record.utc === "string" &&
		typeof record.deviceId === "string" &&
		typeof record.deviceName === "string"
	);
}
