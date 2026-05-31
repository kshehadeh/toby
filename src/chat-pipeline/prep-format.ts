import { randomUUID } from "node:crypto";
import type { UserIntentSpec } from "../ai/pretreatment";

export function formatPrepEndDetail(
	rawUserText: string,
	effectiveText: string,
	spec: UserIntentSpec | null,
): string {
	if (
		process.env.TOBY_DEBUG_PREP === "1" &&
		spec &&
		effectiveText.trim() !== rawUserText.trim()
	) {
		return "Intent specification attached to the model message (debug).";
	}
	if (effectiveText.trim() !== rawUserText.trim()) {
		return "Intent specification attached to the model message.";
	}
	return "Request prepared.";
}

export function createPrepId(willPretreat: boolean): string | null {
	return willPretreat ? randomUUID() : null;
}
