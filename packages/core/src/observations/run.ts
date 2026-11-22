import { readConfig } from "../config/index";
import { deleteNode, getNode } from "../graph/store";
import { daemonLog } from "../logging/daemon-log";
import { ingestObservation } from "./ingest";
import { type ObservationSource, listObservationSources } from "./sources";
import {
	deleteObservation,
	getCursor,
	listPrunableObservations,
	recordCursorError,
	recordCursorSuccess,
} from "./store";

/** First run reaches back this far so "waiting on a reply" has history. */
export const INITIAL_LOOKBACK_DAYS = 14;
/** Re-read this much before the cursor; content hashes make overlap free. */
export const CURSOR_OVERLAP_MS = 60 * 60 * 1000;
export const OBSERVATION_RETENTION_DAYS = 45;
const SOURCE_TIMEOUT_MS = 60_000;
/** Items requested per `activity.recent` call. */
const PAGE_LIMIT = 500;
/** Pages drained per source per run; the cursor resumes where it stopped. */
const MAX_PAGES_PER_RUN = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SourceIngestStats {
	readonly sourceId: string;
	readonly fetched: number;
	readonly created: number;
	readonly updated: number;
	readonly unchanged: number;
	readonly error?: string;
}

/** Whether a source is on: explicit config wins, else its default. */
export function isSourceEnabled(
	source: Pick<ObservationSource, "id" | "defaultEnabled">,
	config: Readonly<Record<string, boolean>> | undefined = readConfig().followups
		?.sources,
): boolean {
	return config?.[source.id] ?? source.defaultEnabled;
}

async function withTimeout<T>(ms: number, run: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			run,
			new Promise<T>((_, reject) => {
				timer = setTimeout(() => reject(new Error("Timed out")), ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function latestOccurredAt(
	observations: ReadonlyArray<{ readonly occurredAt: string }>,
): string | undefined {
	let latest: string | undefined;
	let latestMs = Number.NEGATIVE_INFINITY;
	for (const { occurredAt } of observations) {
		const ms = Date.parse(occurredAt);
		if (Number.isFinite(ms) && ms > latestMs) {
			latestMs = ms;
			latest = new Date(ms).toISOString();
		}
	}
	return latest;
}

/** Pull one source from its cursor and ingest what changed. Never throws. */
export async function ingestSource(
	source: ObservationSource,
	now = new Date(),
): Promise<SourceIngestStats> {
	const cursor = getCursor(source.id);
	const since =
		cursor?.since ??
		new Date(now.getTime() - INITIAL_LOOKBACK_DAYS * DAY_MS).toISOString();
	const at = now.toISOString();
	try {
		let pageSince = since;
		let fetched = 0;
		let created = 0;
		let updated = 0;
		let unchanged = 0;
		let drained = false;
		const selfEmails = new Set<string>();
		const selfHandles = new Set<string>();
		for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
			const result = await withTimeout(
				SOURCE_TIMEOUT_MS,
				source.collect({ since: pageSince, limit: PAGE_LIMIT }),
			);
			for (const e of result.self?.emails ?? [])
				selfEmails.add(e.trim().toLowerCase());
			for (const h of result.self?.handles ?? []) selfHandles.add(h);
			const self = { emails: [...selfEmails], handles: [...selfHandles] };
			fetched += result.observations.length;
			for (const input of result.observations) {
				try {
					const r = ingestObservation(source.id, input, self, now);
					if (r.status === "new") created++;
					else if (r.status === "updated") updated++;
					else unchanged++;
				} catch (error) {
					daemonLog("warn", "general", "observation_ingest_failed", {
						source: source.id,
						externalId: input.externalId,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}
			if (result.observations.length < PAGE_LIMIT) {
				drained = true;
				break;
			}
			// A full page means the source truncated. Sources return the oldest
			// items first, so continue from the newest one we received.
			const newest = latestOccurredAt(result.observations);
			if (!newest || Date.parse(newest) <= Date.parse(pageSince)) {
				// Every item shares the page start; advancing is the only way forward.
				drained = true;
				break;
			}
			pageSince = newest;
		}
		const self = { emails: [...selfEmails], handles: [...selfHandles] };
		recordCursorSuccess(source.id, {
			since: drained
				? new Date(now.getTime() - CURSOR_OVERLAP_MS).toISOString()
				: pageSince,
			at,
			...(self.emails.length || self.handles.length ? { self } : {}),
			ingested: created + updated,
		});
		return {
			sourceId: source.id,
			fetched,
			created,
			updated,
			unchanged,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		recordCursorError(source.id, message, at);
		daemonLog("warn", "general", "observation_source_failed", {
			source: source.id,
			error: message,
		});
		return {
			sourceId: source.id,
			fetched: 0,
			created: 0,
			updated: 0,
			unchanged: 0,
			error: message,
		};
	}
}

/** Ingest every enabled source, one at a time (plugins are subprocesses). */
export async function runObservationIngest(
	params: {
		readonly now?: Date;
		readonly sources?: readonly ObservationSource[];
	} = {},
): Promise<SourceIngestStats[]> {
	const now = params.now ?? new Date();
	const sources = params.sources ?? (await listObservationSources());
	const enabled = readConfig().followups?.sources;
	const stats: SourceIngestStats[] = [];
	for (const source of sources) {
		if (!isSourceEnabled(source, enabled)) continue;
		stats.push(await ingestSource(source, now));
	}
	return stats;
}

/**
 * Drop observations past retention unless a loop cites them. Their graph
 * nodes go too, except todo nodes, which loops and todos still reference.
 */
export function pruneObservations(now = new Date()): number {
	const cutoff = new Date(
		now.getTime() - OBSERVATION_RETENTION_DAYS * DAY_MS,
	).toISOString();
	let removed = 0;
	for (;;) {
		const batch = listPrunableObservations(cutoff, 500);
		if (batch.length === 0) break;
		for (const o of batch) {
			const node = getNode(o.nodeId);
			if (node && node.type !== "todo") deleteNode(node.id);
			deleteObservation(o.id);
			removed++;
		}
		if (batch.length < 500) break;
	}
	return removed;
}
