import {
	getChatInboundDisabledReason,
	readChatInboundConfig,
} from "../config/chat-inbound";
import { daemonLog } from "../logging/daemon-log";
import { startChatInboundListeners } from "./listeners";
import { setChatInboundStatus } from "./status";

let parentSignal: AbortSignal | null = null;
let reloadWaiters: Array<() => void> = [];

function waitForReload(): Promise<void> {
	return new Promise((resolve) => {
		reloadWaiters.push(resolve);
	});
}

function waitForAbort(signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		signal.addEventListener("abort", () => resolve(), { once: true });
	});
}

/**
 * Immediately align the inbound status snapshot with current config when
 * inbound is disabled/misconfigured. Used so `/api/daemon/status` and the
 * sidebar popup update without waiting for a full listener restart.
 */
export function syncChatInboundStatusFromConfig(): void {
	const reason = getChatInboundDisabledReason();
	if (!reason) return;
	const cfg = readChatInboundConfig();
	const integration = cfg.integration?.trim() || null;
	setChatInboundStatus({
		integration,
		status: "disabled",
		detail: null,
		activeConversationName: null,
		activeSince: null,
		activeKind: null,
	});
}

/**
 * Request a hot-reload of inbound listeners (e.g. after configure changes).
 * No-op if the supervisor is not running; still syncs disabled status.
 */
export function requestChatInboundReload(): void {
	syncChatInboundStatusFromConfig();
	if (reloadWaiters.length === 0) {
		return;
	}
	const waiters = reloadWaiters;
	reloadWaiters = [];
	for (const resolve of waiters) {
		resolve();
	}
	daemonLog("info", "inbound", "inbound_reload_requested", {});
}

/**
 * Long-lived supervisor: runs inbound listeners and restarts them when
 * {@link requestChatInboundReload} is called, until `signal` aborts.
 *
 * When inbound is disabled, the inner listener returns immediately; this
 * supervisor then waits for a reload or parent abort instead of spinning.
 */
export async function runChatInboundSupervisor(
	signal: AbortSignal,
): Promise<void> {
	parentSignal = signal;
	try {
		while (!signal.aborted) {
			const generation = new AbortController();
			const onParentAbort = () => generation.abort();
			signal.addEventListener("abort", onParentAbort);

			const reloadPromise = waitForReload();
			const listenerPromise = startChatInboundListeners(generation.signal);

			const winner = await Promise.race([
				listenerPromise.then(() => "listener" as const),
				reloadPromise.then(() => "reload" as const),
				waitForAbort(signal).then(() => "abort" as const),
			]);

			generation.abort();
			signal.removeEventListener("abort", onParentAbort);
			// Ensure dispose / status idle paths finish after abort.
			await listenerPromise.catch(() => undefined);

			if (winner === "abort" || signal.aborted) {
				break;
			}

			if (winner === "reload") {
				daemonLog("info", "inbound", "inbound_reloading", {});
				// Loop immediately with new config.
				continue;
			}

			// Listener exited on its own (disabled, connect error, etc.).
			// Park until configure reloads inbound or the daemon stops.
			await Promise.race([waitForReload(), waitForAbort(signal)]);
			if (signal.aborted) {
				break;
			}
			daemonLog("info", "inbound", "inbound_reloading", {
				reason: "after_listener_exit",
			});
		}
	} finally {
		parentSignal = null;
		// Unblock any pending waiters so callers do not hang on shutdown.
		const waiters = reloadWaiters;
		reloadWaiters = [];
		for (const resolve of waiters) {
			resolve();
		}
	}
}

/** Test helper: whether a parent signal is currently bound. */
export function isChatInboundSupervisorBound(): boolean {
	return parentSignal !== null && !parentSignal.aborted;
}
