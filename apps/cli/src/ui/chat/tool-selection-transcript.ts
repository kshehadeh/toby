import { filterToolNamesByRelevance } from "@toby/core/chat-pipeline/run-turn";
import type { TranscriptEntry } from "./types";

const TOBY_INTEGRATION_LABEL = "Toby";

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

export function buildToolSelectionTranscriptEntries(params: {
	readonly allToolNames: readonly string[];
	readonly toolIntegrationLabels: Readonly<Record<string, string>>;
	readonly relevantTools: readonly string[] | undefined;
	readonly pretreatmentRan: boolean;
}): TranscriptEntry[] {
	if (!params.pretreatmentRan) {
		return [];
	}

	const summary = summarizeToolCountsByIntegration(params);
	if (summary.length === 0) {
		return [];
	}

	const narrowed =
		params.relevantTools !== undefined && params.relevantTools.length > 0;
	const prefix = narrowed ? "Tools selected" : "Tools in scope";

	return summary.map(({ label, count }) => ({
		kind: "meta" as const,
		text: `${prefix}: ${label} (${count})`,
	}));
}
