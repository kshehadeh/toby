import type { FlowDestination } from "./document-types";
import type { ExtractedFlowResult } from "./extract-result";
import { executeToolRef } from "./tool-resolve";

export type FlowDestinationDelivery = {
	readonly type: FlowDestination["type"];
	readonly ok: boolean;
	readonly error?: string;
};

async function deliverOne(
	destination: FlowDestination,
	result: ExtractedFlowResult,
): Promise<FlowDestinationDelivery> {
	if (destination.type === "modal" || destination.type === "dashboard") {
		return { type: destination.type, ok: true };
	}

	if (!result.text.trim()) {
		return {
			type: destination.type,
			ok: false,
			error: "Flow produced an empty result",
		};
	}

	if (destination.type === "email") {
		const exec = await executeToolRef(
			{ moduleName: "email", toolName: "sendEmail" },
			{
				to: [...destination.to],
				subject: destination.subject,
				body: result.text,
				...(destination.cc && destination.cc.length > 0
					? { cc: [...destination.cc] }
					: {}),
			},
		);
		return exec.ok
			? { type: "email", ok: true }
			: { type: "email", ok: false, error: exec.error };
	}

	const exec = await executeToolRef(
		{ moduleName: "slack", toolName: "postToChannel" },
		{ channel: destination.channel, text: result.text },
	);
	return exec.ok
		? { type: "slack", ok: true }
		: { type: "slack", ok: false, error: exec.error };
}

/** Modal and dashboard only register a sink; they are not daemon side effects. */
function isRegistrationDestination(type: FlowDestination["type"]): boolean {
	return type === "modal" || type === "dashboard";
}

/** Deliver non-node sinks. Modal/dashboard are recorded as ok without a tool call. */
export async function deliverFlowDestinations(params: {
	readonly destinations: readonly FlowDestination[];
	readonly result: ExtractedFlowResult;
}): Promise<readonly FlowDestinationDelivery[]> {
	const out: FlowDestinationDelivery[] = [];
	for (const destination of params.destinations) {
		out.push(await deliverOne(destination, params.result));
	}
	return out;
}

export function destinationDeliveryFailed(
	results: readonly FlowDestinationDelivery[],
): FlowDestinationDelivery[] {
	return results.filter(
		(item) => !isRegistrationDestination(item.type) && !item.ok,
	);
}
