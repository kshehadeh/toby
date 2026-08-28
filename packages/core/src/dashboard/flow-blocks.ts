import { getFlowRecord, listFlowRecords } from "../flows/definition-store";
import type {
	FlowDashboardRefresh,
	FlowDashboardVariant,
	FlowDocument,
} from "../flows/document-types";
import { extractFlowResult } from "../flows/extract-result";
import {
	type UserFlowRunOptions,
	type UserFlowRunResult,
	runUserFlowById,
} from "../flows/run-user-flow";
import { getLatestSuccessfulFlowRun } from "../flows/store";
import { DASHBOARD_CONTENT_TTL_MS } from "./cache-ttl";
import type { DashboardBlockContent } from "./types";

export type FlowDashboardBlock = {
	readonly id: string;
	readonly flowId: string;
	readonly title: string;
	readonly description: string | null;
	readonly variant: FlowDashboardVariant;
	/** Informational: resolved policy. Runner is always `"manual"`. */
	readonly refresh: FlowDashboardRefresh;
	readonly lastRanAt: string | null;
	readonly showsResultSheet: boolean;
};

export type FlowDashboardRunFn = (
	flowId: string,
	options?: UserFlowRunOptions,
) => Promise<UserFlowRunResult>;

const inFlightDashboardFlowRuns = new Map<
	string,
	Promise<DashboardBlockContent | null>
>();

function dashboardDest(document: FlowDocument) {
	const dests = document.destinations ?? [];
	return dests.find((d) => d.type === "dashboard");
}

function hasModalDest(document: FlowDocument): boolean {
	return (document.destinations ?? []).some((d) => d.type === "modal");
}

export function resolveDashboardRefresh(
	variant: FlowDashboardVariant,
	refresh?: FlowDashboardRefresh,
): FlowDashboardRefresh {
	if (variant === "runner") return "manual";
	return refresh === "manual" ? "manual" : "asNeeded";
}

function isFreshRun(
	run: {
		readonly completedAt?: string | null;
		readonly startedAt?: string | null;
	},
	now: number,
): boolean {
	const iso = run.completedAt ?? run.startedAt;
	if (!iso) return false;
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return false;
	return now - t < DASHBOARD_CONTENT_TTL_MS;
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
			refresh: resolveDashboardRefresh(dest.variant, dest.refresh),
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
		generatedAt: run.completedAt ?? run.startedAt ?? new Date().toISOString(),
		personaName: run.personaName ?? "",
		count: text ? 1 : 0,
		launchUrls: [],
	};
}

function contentFromUserRun(
	flowId: string,
	run: UserFlowRunResult,
): DashboardBlockContent {
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

function runInformationalDashboardFlow(
	flowId: string,
	document: FlowDocument,
	runUserFlow: FlowDashboardRunFn,
): Promise<DashboardBlockContent | null> {
	const existing = inFlightDashboardFlowRuns.get(flowId);
	if (existing) return existing;

	const promise = (async (): Promise<DashboardBlockContent | null> => {
		const run = await runUserFlow(flowId, {
			trigger: `dashboard.flow:${flowId}`,
			deliverDestinations: false,
		});
		if (!run.ok) {
			const last = getLatestSuccessfulFlowRun(flowId);
			if (last) return contentFromRun(flowId, document, last);
			return emptyFlowContent(flowId, run.completedAt, run.persona?.name ?? "");
		}
		return contentFromUserRun(flowId, run);
	})().finally(() => {
		inFlightDashboardFlowRuns.delete(flowId);
	});

	inFlightDashboardFlowRuns.set(flowId, promise);
	return promise;
}

/**
 * Body for a custom flow dashboard card.
 * Runner cards never run. Informational: as-needed matches built-in soft
 * refresh; manual is last success until an explicit force refresh.
 */
export async function getFlowDashboardContent(
	flowId: string,
	params?: {
		readonly force?: boolean;
		readonly runUserFlow?: FlowDashboardRunFn;
		readonly now?: number;
	},
): Promise<DashboardBlockContent | null> {
	const record = getFlowRecord(flowId);
	if (!record || record.builtin) return null;
	const dest = dashboardDest(record.document);
	if (!dest || dest.type !== "dashboard") return null;

	const runUserFlow = params?.runUserFlow ?? runUserFlowById;
	const now = params?.now ?? Date.now();

	if (dest.variant === "runner") {
		const last = getLatestSuccessfulFlowRun(flowId);
		return emptyFlowContent(
			flowId,
			last?.completedAt ?? last?.startedAt ?? record.updatedAt,
			last?.personaName ?? "",
		);
	}

	const refresh = resolveDashboardRefresh(dest.variant, dest.refresh);
	const last = getLatestSuccessfulFlowRun(flowId);

	if (params?.force) {
		return runInformationalDashboardFlow(flowId, record.document, runUserFlow);
	}

	if (refresh === "manual") {
		if (!last) {
			return emptyFlowContent(flowId, record.updatedAt, "");
		}
		return contentFromRun(flowId, record.document, last);
	}

	if (!last) {
		return runInformationalDashboardFlow(flowId, record.document, runUserFlow);
	}

	const content = contentFromRun(flowId, record.document, last);
	if (!isFreshRun(last, now)) {
		runInformationalDashboardFlow(flowId, record.document, runUserFlow).catch(
			() => {},
		);
	}
	return content;
}
