import { ALWAYS_INCLUDED_TOOLS, filterToolNamesByRelevance } from "./run-turn";
import type { NoticeTone, TranscriptEntry } from "./transcript-types";

function buildNoticeEntry(
	text: string,
	tone: NoticeTone = "info",
): Extract<TranscriptEntry, { kind: "notice" }> {
	return { kind: "notice", text, tone };
}

/** Build transcript notice entries for pretreatment-selected skills and tools. */
export function buildSelectionTranscriptEntries(params: {
	readonly relevantSkills: readonly string[];
	readonly allToolNames: readonly string[];
	readonly toolIntegrationLabels: Readonly<Record<string, string>>;
	readonly relevantTools: readonly string[] | undefined;
	readonly pretreatmentRan: boolean;
}): TranscriptEntry[] {
	const entries: TranscriptEntry[] = [];
	if (!params.pretreatmentRan) {
		return entries;
	}

	const skills = params.relevantSkills.filter((s) => s.trim());
	if (skills.length > 0) {
		entries.push(buildNoticeEntry(`Skills: ${skills.join(", ")}`));
	}

	const activeNames = filterToolNamesByRelevance(
		params.allToolNames,
		params.relevantTools,
	);
	if (activeNames.length === 0) {
		return entries;
	}

	const nonGlobal = activeNames.filter((n) => !ALWAYS_INCLUDED_TOOLS.has(n));
	const globalCount = activeNames.length - nonGlobal.length;
	const totalLabel =
		nonGlobal.length > 0
			? `${activeNames.length} tools`
			: `${globalCount} core tools`;

	// The native app consumes this hidden notice as Activity Card metadata.
	// Include every selected name so the footer can reveal the complete set.
	entries.push(buildNoticeEntry(`${totalLabel}: ${activeNames.join(", ")}`));
	return entries;
}
