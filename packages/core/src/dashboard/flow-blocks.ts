import { getFlowRecord, listFlowRecords } from "../flows/definition-store";
import type {
	FlowDashboardVariant,
	FlowDocument,
} from "../flows/document-types";
import { extractFlowResult } from "../flows/extract-result";
import { runUserFlowById } from "../flows/run-user-flow";
import { getLatestSuccessfulFlowRun } from "../flows/store";
import type { DashboardBlockContent } from "./types";

export type FlowDashboardBlock = {
	readonly id: string;
	readonly flowId: string;
	readonly title: string;
	readonly description: string | null;
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

/** Custom flows that opted into a home-dashboard card. */
export function listFlowDashboardBlocks(): readonly FlowDashboardBlock[] {
	const out: FlowDashboardBlock[] = [];
	for (const record of listFlowRecords()) {
		if (record.builtin) continue;
		const dest = dashboardDest(record.document);
		if (!dest || dest.type !== "dashboard") continue;
		const last = getLatestSuccessfulFlowRun(record.id);
		out.push({
			id: record.id,
			flowId: record.id,
			title: record.name,
			description: record.description,
			variant: dest.variant,
			lastRanAt: last?.completedAt ?? last?.startedAt ?? null,
			showsResultSheet: hasModalDest(record.document),
		});
	}
	return out.sort((a, b) => {
		if (a.variant !== b.variant) {
			return a.variant === "informational" ? -1 : 1;
		}
		return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
	});
}

function emptyFlowContent(
	flowId: string,
	generatedAt: string,
	personaName: string,
): DashboardBlockContent {
	return {
		category: flowId,
		text: "",
		generatedAt,
		personaName,
		count: 0,
		launchUrls: [],
	};
}

/**
 * Body for a custom flow dashboard card.
 * Runner cards never run. Informational soft = last success; force = run now.
 */
export async function getFlowDashboardContent(
	flowId: string,
	params?: { readonly force?: boolean },
): Promise<DashboardBlockContent | null> {
	const record = getFlowRecord(flowId);
	if (!record || record.builtin) return null;
	const dest = dashboardDest(record.document);
	if (!dest || dest.type !== "dashboard") return null;

	if (dest.variant === "runner") {
		const last = getLatestSuccessfulFlowRun(flowId);
		return emptyFlowContent(
			flowId,
			last?.completedAt ?? last?.startedAt ?? record.updatedAt,
			last?.personaName ?? "",
		);
	}

	if (params?.force) {
		const run = await runUserFlowById(flowId, {
			trigger: `dashboard.flow:${flowId}`,
		});
		if (!run.ok) {
			const last = getLatestSuccessfulFlowRun(flowId);
			if (!last) return null;
			return contentFromRun(flowId, record.document, last);
		}
		const text = run.extracted?.text?.trim() ?? "";
		return {
			category: flowId,
			text,
			generatedAt: run.completedAt,
			personaName: run.persona?.name ?? "",
			count: text ? 1 : 0,
			launchUrls: [],
		};
	}

	const last = getLatestSuccessfulFlowRun(flowId);
	if (!last) {
		return emptyFlowContent(flowId, record.updatedAt, "");
	}
	return contentFromRun(flowId, record.document, last);
}

function contentFromRun(
	flowId: string,
	document: FlowDocument,
	run: NonNullable<ReturnType<typeof getLatestSuccessfulFlowRun>>,
): DashboardBlockContent {
	const bag =
		run.finalOutputs &&
		typeof run.finalOutputs === "object" &&
		!Array.isArray(run.finalOutputs)
			? (run.finalOutputs as Record<string, unknown>)
			: {};
	const lastNode = run.nodes[run.nodes.length - 1];
	const storedOutputs = lastNode?.outputs;
	const nodeResult =
		storedOutputs &&
		typeof storedOutputs === "object" &&
		!Array.isArray(storedOutputs) &&
		"nodeResult" in storedOutputs
			? (storedOutputs as { nodeResult?: unknown }).nodeResult
			: storedOutputs;
	const extracted = extractFlowResult(bag, document, {
		lastNodeResult: nodeResult,
	});
	const text = extracted.text.trim();
	return {
		category: flowId,
		text,
		generatedAt: run.completedAt ?? run.startedAt,
		personaName: run.personaName ?? "",
		count: text ? 1 : 0,
		launchUrls: [],
	};
}
