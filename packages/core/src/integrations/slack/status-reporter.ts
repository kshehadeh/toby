import type { InboundStatusReporter } from "../../chat-inbound/types";
import { daemonLog } from "../../logging/daemon-log";
import {
	deleteSlackMessage,
	postSlackStatusMessage,
	resolveSlackPostToken,
	updateSlackStatusMessage,
} from "./client";
const STATUS_UPDATE_MIN_INTERVAL_MS = 1000;

export type SlackStatusMessageApi = {
	readonly post: typeof postSlackStatusMessage;
	readonly update: typeof updateSlackStatusMessage;
	readonly delete: typeof deleteSlackMessage;
};

const defaultSlackStatusApi: SlackStatusMessageApi = {
	post: postSlackStatusMessage,
	update: updateSlackStatusMessage,
	delete: deleteSlackMessage,
};

export function createSlackStatusReporter(params: {
	readonly channelId: string;
	readonly threadTs?: string;
	readonly token?: string;
	readonly api?: SlackStatusMessageApi;
	readonly now?: () => number;
	readonly setTimeoutFn?: typeof setTimeout;
	readonly clearTimeoutFn?: typeof clearTimeout;
}): InboundStatusReporter {
	const api = params.api ?? defaultSlackStatusApi;
	const token = params.token?.trim() || resolveSlackPostToken();
	const threadTs = params.threadTs;
	const now = params.now ?? (() => Date.now());
	const setTimeoutFn = params.setTimeoutFn ?? setTimeout;
	const clearTimeoutFn = params.clearTimeoutFn ?? clearTimeout;

	let messageRef: { readonly channel: string; readonly ts: string } | null =
		null;
	let lastShownMrkdwn: string | null = null;
	let lastUpdateAtMs = 0;
	let pendingMrkdwn: string | null = null;
	let flushTimer: ReturnType<typeof setTimeout> | null = null;
	let inFlight: Promise<void> = Promise.resolve();

	const enqueue = (task: () => Promise<void>): void => {
		inFlight = inFlight.then(task).catch((error) => {
			const msg = error instanceof Error ? error.message : String(error);
			daemonLog("warn", "inbound", "slack_status_reporter_error", {
				message: msg,
			});
		});
	};

	const flushPending = (): void => {
		if (pendingMrkdwn === null) {
			return;
		}
		const mrkdwn = pendingMrkdwn;
		pendingMrkdwn = null;
		if (flushTimer !== null) {
			clearTimeoutFn(flushTimer);
			flushTimer = null;
		}
		enqueue(() => applyMrkdwn(mrkdwn));
	};

	const scheduleFlush = (delayMs: number): void => {
		if (flushTimer !== null) {
			return;
		}
		flushTimer = setTimeoutFn(() => {
			flushTimer = null;
			flushPending();
		}, delayMs);
	};

	const applyMrkdwn = async (mrkdwnLine: string): Promise<void> => {
		const trimmed = mrkdwnLine.trim();
		if (!trimmed || trimmed === lastShownMrkdwn) {
			return;
		}

		if (!messageRef) {
			messageRef = await api.post({
				channel: params.channelId,
				mrkdwnLine: trimmed,
				threadTs,
				token,
			});
			lastShownMrkdwn = trimmed;
			lastUpdateAtMs = now();
			return;
		}

		await api.update({
			channel: messageRef.channel,
			ts: messageRef.ts,
			mrkdwnLine: trimmed,
			token,
		});
		lastShownMrkdwn = trimmed;
		lastUpdateAtMs = now();
	};

	return {
		update(mrkdwnLine: string) {
			const trimmed = mrkdwnLine.trim();
			if (!trimmed || trimmed === lastShownMrkdwn) {
				return;
			}

			const elapsed = now() - lastUpdateAtMs;
			if (messageRef === null || elapsed >= STATUS_UPDATE_MIN_INTERVAL_MS) {
				pendingMrkdwn = null;
				if (flushTimer !== null) {
					clearTimeoutFn(flushTimer);
					flushTimer = null;
				}
				enqueue(() => applyMrkdwn(trimmed));
				return;
			}

			pendingMrkdwn = trimmed;
			scheduleFlush(STATUS_UPDATE_MIN_INTERVAL_MS - elapsed);
		},

		async clear() {
			if (flushTimer !== null) {
				clearTimeoutFn(flushTimer);
				flushTimer = null;
			}
			pendingMrkdwn = null;

			await inFlight;

			const ref = messageRef;
			messageRef = null;
			lastShownMrkdwn = null;
			if (!ref) {
				return;
			}

			try {
				await api.delete({
					channel: ref.channel,
					ts: ref.ts,
					token,
				});
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				daemonLog("warn", "inbound", "slack_status_delete_failed", {
					message: msg,
				});
			}
		},
	};
}

export function createNoOpStatusReporter(): InboundStatusReporter {
	return {
		update() {},
		async clear() {},
	};
}
