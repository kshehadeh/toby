import { listFlowRecords } from "../flows/definition-store";
import type {
	FlowDashboardVariant,
	FlowDocument,
} from "../flows/document-types";
import { getLatestSuccessfulFlowRun } from "../flows/store";

/**
 * A custom flow placed in the Home Actions sidebar (runner destination +
 * enabled `home.action` trigger). Home has no flow-produced cards.
 */
export type FlowDashboardBlock = {
	readonly id: string;
	readonly flowId: string;
	readonly title: string;
	readonly description: string | null;
	readonly icon: string | null;
	readonly color: string | null;
	readonly dashboardColor: string | null;
	readonly variant: FlowDashboardVariant;
	readonly lastRanAt: string | null;
	readonly showsResultSheet: boolean;
};

function dashboardDest(document: FlowDocument) {
	const dests = document.destinations ?? [];
	return dests.find((d) => d.type === "dashboard");
}

function hasModalDest(document: FlowDocument): boolean {
	return (document.destinations ?? []).some((d) => d.type === "modal");
}

/** Custom flows that show as Home Actions, sorted by title. */
export function listFlowDashboardBlocks(): readonly FlowDashboardBlock[] {
	const out: FlowDashboardBlock[] = [];
	for (const record of listFlowRecords()) {
		if (record.builtin) continue;
		const dest = dashboardDest(record.document);
		// Stored flows may still carry a retired informational destination.
		if (dest?.type !== "dashboard" || dest.variant !== "runner") continue;
		if (
			!record.document.triggers?.some(
				(t) => t.enabled && t.source.type === "home.action",
			)
		)
			continue;
		const last = getLatestSuccessfulFlowRun(record.id);
		out.push({
			id: record.id,
			flowId: record.id,
			title: record.name,
			description: record.description,
			icon: record.document.icon ?? null,
			color: record.document.color ?? null,
			dashboardColor: dest.color ?? null,
			variant: "runner",
			lastRanAt: last?.completedAt ?? last?.startedAt ?? null,
			showsResultSheet: hasModalDest(record.document),
		});
	}
	return out.sort((a, b) =>
		a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
	);
}
