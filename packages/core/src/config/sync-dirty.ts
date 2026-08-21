/** In-process dirty flag so config writes do not I/O on the hot path. */

const DEFAULT_DEBOUNCE_MS = 5_000;

let dirty = false;
let dirtyAt = 0;
let applyingRemote = 0;

export function markSyncDirty(): void {
	if (applyingRemote > 0) {
		return;
	}
	dirty = true;
	dirtyAt = Date.now();
}

export function isSyncDirty(): boolean {
	return dirty;
}

export function clearSyncDirty(): void {
	dirty = false;
	dirtyAt = 0;
}

export function shouldPushNow(
	now = Date.now(),
	debounceMs = DEFAULT_DEBOUNCE_MS,
): boolean {
	return dirty && now - dirtyAt >= debounceMs;
}

export function beginApplyingRemote(): void {
	applyingRemote += 1;
}

export function endApplyingRemote(): void {
	applyingRemote = Math.max(0, applyingRemote - 1);
}

export function isApplyingRemote(): boolean {
	return applyingRemote > 0;
}

/** Tests only. */
export function resetSyncDirty(): void {
	dirty = false;
	dirtyAt = 0;
	applyingRemote = 0;
}

export const SYNC_DEBOUNCE_MS = DEFAULT_DEBOUNCE_MS;
