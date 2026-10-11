import "../index";
import { randomUUID } from "node:crypto";
import { daemonLog } from "../../logging/daemon-log";
import { resolveNativePort } from "../../native-app/client";
import { type UserFlowRunResult, runUserFlow } from "../run-user-flow";
import {
	claimTriggerDecision,
	enqueueScheduledFlows,
	finishTriggerDecision,
	ingestNativeEvents,
	listTriggerBindings,
	recoverTriggerDecisions,
	triggerInputs,
} from "./store";

let sourceStatus = {
	state: "idle",
	message: "No enabled macOS triggers",
	lastPollAt: null as string | null,
};
export function flowTriggerSourceStatus() {
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
		`http://127.0.0.1:${port}/api/native/flows/triggers/${path}`,
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
export async function executeFlowTriggerWorker(
	signal: AbortSignal,
	decisionId?: string,
): Promise<UserFlowRunResult | null> {
	const run = claimTriggerDecision(new Date(), decisionId);
	if (!run) return null;
	try {
		const result = await runUserFlow(run.binding.flowId, run.binding.document, {
			inputs: triggerInputs(run.binding, run.event, run.id),
			trigger: `${run.event.type}:${run.binding.trigger.id}`,
			abortSignal: signal,
		});
		finishTriggerDecision(
			run.id,
			signal.aborted ? "interrupted" : result.ok ? "success" : "error",
			result.ok ? null : (result.error ?? null),
			result.runId ?? null,
			result.extracted?.text ?? null,
		);
		if (run.binding.trigger.notifyOnCompletion && !signal.aborted) {
			try {
				await native(
					"completion-notification",
					"POST",
					{
						flowId: run.binding.flowId,
						runId: result.runId,
						name: run.binding.document.name,
						status: result.ok ? "success" : "error",
					},
					signal,
				);
			} catch {
				/* Best effort notification. */
			}
		}
		return result;
	} catch (error) {
		finishTriggerDecision(
			run.id,
			signal.aborted ? "interrupted" : "error",
			String(error),
		);
		const completedAt = new Date().toISOString();
		return {
			ok: false,
			flowName: run.binding.document.name,
			outputs: {},
			nodeTrace: [],
			error: String(error),
			startedAt: completedAt,
			completedAt,
			durationMs: 0,
			extracted: null,
			destinations: [],
		};
	}
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
export async function runFlowTriggerSupervisor(
	signal: AbortSignal,
): Promise<void> {
	recoverTriggerDecisions();

	const owner = randomUUID();
	let cursor: { sessionId: string; sequence: number } | null = null;
	let activeTypes = "";
	const running = new Set<Promise<void>>();
	let failures = 0;

	try {
		while (!signal.aborted) {
			enqueueScheduledFlows();
			const enabled = listTriggerBindings().filter(
				(a) => a.trigger.enabled && a.trigger.source.type.startsWith("macos."),
			);
			const watches = enabled
				.filter((a) => a.trigger.source.type === "macos.fileChanges")
				.map((a) => ({ id: `${a.id}:${a.revision}`, ...a.trigger.source }));
			const types = [
				...new Set(enabled.map((a) => a.trigger.source.type)),
			].sort();
			try {
				if (!types.length) {
					if (activeTypes)
						await native("subscriptions", "PUT", { owner, types: [] }, signal);
					activeTypes = "";
					cursor = null;
					sourceStatus = {
						state: "idle",
						message: "No enabled macOS triggers",
						lastPollAt: null,
					};
				} else {
					const subscription = await native(
						"subscriptions",
						"PUT",
						{ owner, types, watches },
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
						daemonLog("warn", "daemon", "flow_trigger_event_gap", {
							sessionId,
						});
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
						ingestNativeEvents(batch.events, next);
						cursor = next;
					}
					const folderErrors = subscription.folderErrors as
						| Record<string, string>
						| undefined;
					const unavailable =
						(folderErrors && Object.keys(folderErrors).length > 0) ||
						(subscription.idleAvailable === false &&
							types.includes("macos.userReturned"));
					sourceStatus = {
						state: unavailable ? "unavailable" : "observing",
						message: unavailable
							? (folderErrors && Object.values(folderErrors)[0]) ||
								"Idle input timing unavailable"
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
					daemonLog("warn", "daemon", "flow_trigger_source_unavailable", {
						error: String(error),
					});
				// Preserve cursor within the same native session for a short transport outage.
			}
			while (running.size < 2 && !signal.aborted) {
				// The async worker claims synchronously before its first await.
				const worker = executeFlowTriggerWorker(signal);
				const task: Promise<void> = worker
					.then(() => {})
					.catch((error) => {
						daemonLog("error", "daemon", "flow_trigger_worker_failed", {
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
