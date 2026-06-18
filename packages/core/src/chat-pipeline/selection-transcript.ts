import { ALWAYS_INCLUDED_TOOLS, filterToolNamesByRelevance } from "./run-turn";
import type { NoticeTone, TranscriptEntry } from "./transcript-types";

const MAX_NON_GLOBAL_TOOL_NAMES = 3;

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

	const head = nonGlobal.slice(0, MAX_NON_GLOBAL_TOOL_NAMES);
	const extra = nonGlobal.length - head.length;

	let text = totalLabel;
	if (head.length > 0) {
		const namesStr = head.join(", ");
		const suffix = extra > 0 ? ` … +${extra} more` : "";
		text = `${totalLabel}: ${namesStr}${suffix}`;
	}

	entries.push(buildNoticeEntry(text));
	return entries;
}
