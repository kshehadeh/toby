import type { TranscriptEntry } from "./transcript-types";

export function isTranscriptWorkEntry(entry: TranscriptEntry): boolean {
	if (entry.kind === "tool_call" || entry.kind === "tool_output") {
		return true;
	}
	if (entry.kind !== "boxed_step") {
		return false;
	}
	return (
		entry.variant === "lifecycle" ||
		entry.variant === "prep" ||
		entry.variant === "tool" ||
		entry.variant === "plan" ||
		entry.variant === "thinking"
	);
}

function isAssistantTranscriptEntry(entry: TranscriptEntry): boolean {
	return (
		entry.kind === "assistant" ||
		(entry.kind === "boxed_step" &&
			(entry.variant === "assistant" || entry.variant === "assistant_interim"))
	);
}

/** Insert a persisted work-duration marker before the assistant reply for a turn. */
export function insertTurnWorkSummary(
	entries: readonly TranscriptEntry[],
	userTurnIndex: number,
	durationMs: number,
): TranscriptEntry[] {
	if (durationMs <= 0 || userTurnIndex < 0 || userTurnIndex >= entries.length) {
		return [...entries];
	}

	const sliceStart = userTurnIndex + 1;
	const afterUser = entries.slice(sliceStart);
	const assistantOffset = afterUser.findIndex(isAssistantTranscriptEntry);

	const withoutExisting = entries.filter(
		(entry, index) => !(index > userTurnIndex && entry.kind === "turn_work"),
	);
	const next = [...withoutExisting];
	const insertAt =
		assistantOffset === -1
			? next.length
			: sliceStart +
				afterUser
					.slice(0, assistantOffset)
					.filter((entry) => entry.kind !== "turn_work").length;

	next.splice(insertAt, 0, { kind: "turn_work", durationMs });
	return next;
}
