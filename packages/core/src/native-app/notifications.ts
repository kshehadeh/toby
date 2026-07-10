import fs from "node:fs";
import path from "node:path";
import { resolveTobyDir } from "../config/index";

type ScheduleCompletionStatus = "success" | "error";

export interface ScheduleCompletionNotification {
	readonly scheduleId: string;
	readonly scheduleName: string;
	readonly runId: string;
	readonly status: ScheduleCompletionStatus;
	readonly error?: string;
}

const REQUEST_TIMEOUT_MS = 2_000;

function resolveNativePort(): number | null {
	const portFile = path.join(resolveTobyDir(), "native-port");
	try {
		const port = Number.parseInt(fs.readFileSync(portFile, "utf8").trim(), 10);
		return Number.isNaN(port) ? null : port;
	} catch {
		return null;
	}
}

export async function notifyNativeScheduleCompleted(
	notification: ScheduleCompletionNotification,
): Promise<void> {
	const port = resolveNativePort();
	if (!port) return;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		await fetch(
			`http://127.0.0.1:${port}/api/native/schedules/completion-notification`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(notification),
				signal: controller.signal,
			},
		);
	} catch {
		// Native app notifications are best-effort. Schedule execution is already persisted.
	} finally {
		clearTimeout(timeout);
	}
}
