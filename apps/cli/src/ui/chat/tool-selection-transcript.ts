import {
	ALWAYS_INCLUDED_TOOLS,
	filterToolNamesByRelevance,
} from "@toby/core/chat-pipeline/run-turn";
import type { TranscriptEntry } from "@toby/core/chat-pipeline/transcript-types";
import { buildSessionNoticeEntry, recordSessionNote } from "./session-note";

const TOBY_INTEGRATION_LABEL = "Toby";
const MAX_NON_GLOBAL_TOOL_NAMES = 3;

export function summarizeToolCountsByIntegration(params: {
	readonly allToolNames: readonly string[];
	readonly toolIntegrationLabels: Readonly<Record<string, string>>;
	readonly relevantTools: readonly string[] | undefined;
}): ReadonlyArray<{ readonly label: string; readonly count: number }> {
	const activeNames = filterToolNamesByRelevance(
		params.allToolNames,
		params.relevantTools,
	);
	const counts = new Map<string, number>();
	for (const name of activeNames) {
		const label =
			params.toolIntegrationLabels[name]?.trim() || TOBY_INTEGRATION_LABEL;
		counts.set(label, (counts.get(label) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([label, count]) => ({ label, count }));
}

export function logToolSelectionNotes(
	sessionId: string | null | undefined,
	params: {
		readonly allToolNames: readonly string[];
		readonly toolIntegrationLabels: Readonly<Record<string, string>>;
		readonly relevantTools: readonly string[] | undefined;
		readonly pretreatmentRan: boolean;
	},
): void {
	if (!params.pretreatmentRan) {
		return;
	}

	const summary = summarizeToolCountsByIntegration(params);
	if (summary.length === 0) {
		return;
	}

	const narrowed =
		params.relevantTools !== undefined && params.relevantTools.length > 0;
	const prefix = narrowed ? "Tools selected" : "Tools in scope";

	for (const { label, count } of summary) {
		recordSessionNote(sessionId, `${prefix}: ${label} (${count})`);
	}
}

/** Build transcript notice entries for selected skills and tools. */
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

	// Skills
	const skills = params.relevantSkills.filter((s) => s.trim());
	if (skills.length > 0) {
		entries.push(buildSessionNoticeEntry(`Skills: ${skills.join(", ")}`));
	}

	// Tools: count of active tools + first few non-global names
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

	entries.push(buildSessionNoticeEntry(text));
	return entries;
}
