import "../flows/index";
import { randomUUID } from "node:crypto";
import { runUserFlowById } from "../flows/run-user-flow";
import { daemonLog } from "../logging/daemon-log";
import { resolveNativePort } from "../native-app/client";
import { automationInputs } from "./matcher";
import {
	claimPendingAutomation,
	finishAutomationRun,
	ingestAutomationBatch,
	listAutomations,
	pruneAutomationHistory,
	recoverAutomationRuns,
	validateAutomationFlow,
} from "./store";

let sourceStatus = {
	state: "idle",
	message: "No enabled automations",
	lastPollAt: null as string | null,
};
export function automationSourceStatus() {
	return sourceStatus;
}
async function native(
	path: string,
	method = "GET",
	body?: unknown,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	const port = resolveNativePort();
	if (!port) throw new Error("Waiting for Toby.app");
	const response = await fetch(
		`http://127.0.0.1:${port}/api/native/automations/${path}`,
		{
			method,
			headers: { "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(2000)])
				: AbortSignal.timeout(2000),
		},
	);
	const payload = (await response.json()) as {
		ok: boolean;
		data: Record<string, unknown>;
		error?: string;
	};
	if (!response.ok || !payload.ok)
		throw new Error(payload.error ?? "Native source unavailable");
	return payload.data;
}
export async function executeAutomationWorker(
	signal: AbortSignal,
	execute = runUserFlowById,
): Promise<boolean> {
	const run = claimPendingAutomation();
	if (!run) return false;
	try {
		validateAutomationFlow(run.definition.action.flowId);
		const result = await execute(run.definition.action.flowId, {
			inputs: automationInputs(run.definition, run.event, run.id),
			trigger: `automation:${run.automationId}:${run.eventId}`,
			abortSignal: signal,
		});
		finishAutomationRun(
			run.id,
			result.ok ? "success" : "error",
			result.ok ? null : result.error,
			result.runId ?? null,
			result.extracted?.text ?? null,
		);
		if (run.definition.notifyOnCompletion && !signal.aborted) {
			try {
				await native(
					"completion-notification",
					"POST",
					{
						automationId: run.automationId,
						runId: run.id,
						name: run.definition.name,
						status: result.ok ? "success" : "error",
					},
					signal,
				);
			} catch {
				/* Notification delivery never invalidates the saved result. */
			}
		}
	} catch (error) {
		finishAutomationRun(
			run.id,
			signal.aborted ? "interrupted" : "error",
			error instanceof Error ? error.message : String(error),
		);
	}
	return true;
}
function pause(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		signal.addEventListener("abort", done, { once: true });
	});
}
export async function runAutomationSupervisor(
	signal: AbortSignal,
): Promise<void> {
	recoverAutomationRuns();
	pruneAutomationHistory();
	const owner = randomUUID();
	let cursor: { sessionId: string; sequence: number } | null = null;
	let activeTypes = "";
	const running = new Set<Promise<void>>();
	let failures = 0;
	let lastPrunedAt = Date.now();
	try {
		while (!signal.aborted) {
			if (Date.now() - lastPrunedAt >= 86400000) {
				pruneAutomationHistory();
				lastPrunedAt = Date.now();
			}
			const types = [
				...new Set(
					listAutomations()
						.filter((a) => a.enabled)
						.map((a) => a.trigger.type),
				),
			].sort();
			try {
				if (!types.length) {
					if (activeTypes)
						await native("subscriptions", "PUT", { owner, types: [] }, signal);
					activeTypes = "";
					cursor = null;
					sourceStatus = {
						state: "idle",
						message: "No enabled automations",
						lastPollAt: null,
					};
				} else {
					const subscription = await native(
						"subscriptions",
						"PUT",
						{ owner, types },
						signal,
					);
					const sessionId = String(subscription.sessionId);
					if (
						!cursor ||
						cursor.sessionId !== sessionId ||
						activeTypes !== types.join(",")
					) {
						cursor = { sessionId, sequence: Number(subscription.sequence) };
					}
					activeTypes = types.join(",");
					const batch = await native(
						`events?sessionId=${encodeURIComponent(cursor.sessionId)}&after=${cursor.sequence}&limit=100`,
						"GET",
						undefined,
						signal,
					);
					if (batch.gap === true) {
						daemonLog("warn", "daemon", "automation_event_gap", { sessionId });
						cursor = { sessionId, sequence: Number(batch.sequence) };
					} else {
						const next: { sessionId: string; sequence: number } = {
							sessionId,
							sequence: Number(batch.sequence),
						};
						if (
							!Array.isArray(batch.events) ||
							!Number.isSafeInteger(next.sequence) ||
							next.sequence < cursor.sequence
						)
							throw new Error("Invalid native event batch");
						ingestAutomationBatch(batch.events, next);
						cursor = next;
					}
					const unavailable =
						subscription.idleAvailable === false &&
						types.includes("macos.userReturned");
					sourceStatus = {
						state: unavailable ? "unavailable" : "observing",
						message: unavailable
							? "Idle input timing unavailable"
							: "Observing macOS events",
						lastPollAt: new Date().toISOString(),
					};
				}
				failures = 0;
			} catch (error) {
				if (signal.aborted) break;
				failures++;
				sourceStatus = {
					state: "waiting",
					message: "Waiting for Toby.app",
					lastPollAt: sourceStatus.lastPollAt,
				};
				if (failures === 1)
					daemonLog("warn", "daemon", "automation_source_unavailable", {
						error: String(error),
					});
				// Preserve cursor within the same native session for a short transport outage.
			}
			while (running.size < 2 && !signal.aborted) {
				// The async worker claims synchronously before its first await.
				const worker = executeAutomationWorker(signal);
				const task: Promise<void> = worker
					.then(() => {})
					.catch((error) => {
						daemonLog("error", "daemon", "automation_worker_failed", {
							error: String(error),
						});
					})
					.finally(() => running.delete(task));
				running.add(task);
				// At most two workers are attempted each cycle, including empty queues.
			}
			await pause(Math.min(15000, 5000 * Math.max(1, failures)), signal);
		}
	} finally {
		await Promise.allSettled([...running]);
		try {
			await native("subscriptions", "PUT", { owner, types: [] });
		} catch {
			/* Leases also expire after 30 seconds. */
		}
		sourceStatus = {
			state: "stopped",
			message: "Daemon stopped",
			lastPollAt: sourceStatus.lastPollAt,
		};
	}
}
