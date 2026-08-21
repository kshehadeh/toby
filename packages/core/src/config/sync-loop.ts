import { daemonLog } from "../logging/daemon-log";
import { isSyncDirty, shouldPushNow } from "./sync-dirty";
import { pullSnapshot, pushSnapshot } from "./sync-engine";
import { readSyncState } from "./sync-state";

const TICK_MS = 1_000;
const PULL_INTERVAL_MS = 60_000;

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return;
	await new Promise<void>((resolve) => {
		const t = setTimeout(resolve, ms);
		const onAbort = () => {
			clearTimeout(t);
			resolve();
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Debounced push + periodic pull while the daemon is running.
 * Cheap when sync is disabled (reads sync-state.json once per second).
 */
export async function runConfigSyncLoop(options: {
	signal: AbortSignal;
}): Promise<void> {
	const signal = options.signal;
	let lastPullAt = 0;

	while (!signal.aborted) {
		try {
			const state = readSyncState();
			if (state.enabled) {
				if (shouldPushNow()) {
					await pushSnapshot();
				} else if (!isSyncDirty()) {
					const now = Date.now();
					if (lastPullAt === 0 || now - lastPullAt >= PULL_INTERVAL_MS) {
						await pullSnapshot({ automatic: true });
						lastPullAt = now;
					}
				}
			} else {
				lastPullAt = 0;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			daemonLog("warn", "sync", "sync_tick_error", { message });
		}
		await sleepWithAbort(TICK_MS, signal);
	}
}
