import { getFlowRecord } from "./definition-store";
import {
	type FlowDestinationDelivery,
	deliverFlowDestinations,
	destinationDeliveryFailed,
} from "./deliver-destinations";
import type { FlowDocument } from "./document-types";
import { type ExtractedFlowResult, extractFlowResult } from "./extract-result";
import { runFlow } from "./runner";
import { completeFlowRunDestinations } from "./store";
import type { FlowResult, FlowRunOptions } from "./types";

export type UserFlowRunOptions = FlowRunOptions & {
	/**
	 * Deliver email/Slack destinations after a successful run.
	 * Default true. Dashboard card generation passes false.
	 */
	readonly deliverDestinations?: boolean;
};

export type UserFlowRunResult = FlowResult & {
	readonly extracted: ExtractedFlowResult | null;
	readonly destinations: readonly FlowDestinationDelivery[];
};

function lastNodeResult(result: FlowResult): unknown {
	const last = result.nodeTrace[result.nodeTrace.length - 1];
	return last?.nodeResult;
}

/**
 * Run a stored flow, extract the declared result, and deliver destinations.
 * Built-in dashboard callers should keep using `runFlow` (no destinations).
 */
export async function runUserFlow(
	id: string,
	document: FlowDocument,
	options: UserFlowRunOptions = {},
): Promise<UserFlowRunResult> {
	const result = await runFlow(id, options);
	if (!result.ok) {
		return {
			...result,
			extracted: null,
			destinations: [],
		};
	}

	const extracted = extractFlowResult(result.outputs, document, {
		lastNodeResult: lastNodeResult(result),
	});
	if (options.deliverDestinations === false) {
		return {
			...result,
			extracted,
			destinations: [],
		};
	}

	const destinations = await deliverFlowDestinations({
		destinations: document.destinations ?? [],
		result: extracted,
	});
	const failed = destinationDeliveryFailed(destinations);
	if (result.runId) {
		completeFlowRunDestinations({
			id: result.runId,
			destinationResults: destinations,
			error:
				failed.length > 0
					? failed
							.map((item) => item.error ?? `${item.type} destination failed`)
							.join("; ")
					: null,
		});
	}

	if (failed.length > 0) {
		return {
			ok: false,
			flowName: result.flowName,
			persona: result.persona,
			provider: result.provider,
			model: result.model,
			outputs: result.outputs,
			nodeTrace: result.nodeTrace,
			error: failed
				.map((item) => item.error ?? `${item.type} destination failed`)
				.join("; "),
			...(result.runId ? { runId: result.runId } : {}),
			startedAt: result.startedAt,
			completedAt: result.completedAt,
			durationMs: result.durationMs,
			extracted,
			destinations,
		};
	}

	return {
		...result,
		extracted,
		destinations,
	};
}

export async function runUserFlowById(
	id: string,
	options: UserFlowRunOptions = {},
): Promise<UserFlowRunResult> {
	const record = getFlowRecord(id);
	if (!record) {
		const startedAt = new Date().toISOString();
		return {
			ok: false,
			flowName: id,
			outputs: {},
			nodeTrace: [],
			error: `Unknown flow "${id}"`,
			startedAt,
			completedAt: startedAt,
			durationMs: 0,
			extracted: null,
			destinations: [],
		};
	}
	return runUserFlow(id, record.document, options);
}
