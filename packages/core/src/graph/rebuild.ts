import { ingestObservation } from "../observations/ingest";
import { allSelfIdentities, listAllObservations } from "../observations/store";
import { backfillMemoryGraph } from "./memory-backfill";
import { clearRebuildableEdges } from "./store";

/** Recreate deterministic observation edges and requeue usable graph nodes. */
export function rebuildGraph(now = new Date()): {
	readonly observations: number;
	readonly edgesRemoved: number;
	readonly memoriesQueued: number;
} {
	const edgesRemoved = clearRebuildableEdges();
	const identities = allSelfIdentities();
	const observations = listAllObservations();
	for (const observation of observations) {
		ingestObservation(
			observation.sourceId,
			{
				externalId: observation.externalId,
				kind: observation.kind,
				...(observation.threadId ? { threadId: observation.threadId } : {}),
				...(observation.direction ? { direction: observation.direction } : {}),
				occurredAt: observation.occurredAt,
				title: observation.title,
				...(observation.excerpt ? { excerpt: observation.excerpt } : {}),
				...(observation.url ? { url: observation.url } : {}),
				actors: observation.actors,
				facts: observation.facts,
			},
			identities,
			now,
			{ force: true },
		);
	}
	const memories = backfillMemoryGraph({ force: true });
	return {
		observations: observations.length,
		edgesRemoved,
		memoriesQueued: memories.queued,
	};
}
