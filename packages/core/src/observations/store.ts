import { randomUUID } from "node:crypto";
import { getDb } from "../memory/memory-store";
import type { Observation, ObservationActor } from "./types";

type ObservationRow = {
	id: string;
	node_id: string;
	source_id: string;
	external_id: string;
	kind: string;
	thread_key: string | null;
	direction: string | null;
	occurred_at: string;
	title: string;
	excerpt: string | null;
	url: string | null;
	actors_json: string;
	facts_json: string;
	content_hash: string;
	ingested_at: string;
};

const COLUMNS =
	"id, node_id, source_id, external_id, kind, thread_key, direction, occurred_at, title, excerpt, url, actors_json, facts_json, content_hash, ingested_at";

function rowToObservation(r: ObservationRow): Observation {
	const threadId = r.thread_key
		? r.thread_key.slice(r.source_id.length + 1)
		: undefined;
	return {
		id: r.id,
		nodeId: r.node_id,
		sourceId: r.source_id,
		externalId: r.external_id,
		kind: r.kind,
		...(threadId ? { threadId } : {}),
		...(r.thread_key ? { threadKey: r.thread_key } : {}),
		...(r.direction
			? { direction: r.direction as "inbound" | "outbound" }
			: {}),
		occurredAt: r.occurred_at,
		title: r.title,
		...(r.excerpt ? { excerpt: r.excerpt } : {}),
		...(r.url ? { url: r.url } : {}),
		actors: JSON.parse(r.actors_json) as ObservationActor[],
		facts: JSON.parse(r.facts_json) as Record<
			string,
			string | number | boolean
		>,
		contentHash: r.content_hash,
		ingestedAt: r.ingested_at,
	};
}

export function findObservation(
	sourceId: string,
	externalId: string,
): Observation | null {
	const row = getDb()
		.query(
			`SELECT ${COLUMNS} FROM observations WHERE source_id = $s AND external_id = $e`,
		)
		.get({ $s: sourceId, $e: externalId }) as ObservationRow | undefined;
	return row ? rowToObservation(row) : null;
}

export function getObservation(id: string): Observation | null {
	const row = getDb()
		.query(`SELECT ${COLUMNS} FROM observations WHERE id = $id`)
		.get({ $id: id }) as ObservationRow | undefined;
	return row ? rowToObservation(row) : null;
}

export function getObservationByNode(nodeId: string): Observation | null {
	const row = getDb()
		.query(`SELECT ${COLUMNS} FROM observations WHERE node_id = $id LIMIT 1`)
		.get({ $id: nodeId }) as ObservationRow | undefined;
	return row ? rowToObservation(row) : null;
}

export function getObservationsByNodes(
	nodeIds: readonly string[],
): Observation[] {
	if (nodeIds.length === 0) return [];
	const params: Record<string, unknown> = {};
	const marks = nodeIds.map((id, i) => {
		params[`$n${i}`] = id;
		return `$n${i}`;
	});
	const rows = getDb()
		.query(
			`SELECT ${COLUMNS} FROM observations WHERE node_id IN (${marks.join(",")}) ORDER BY occurred_at ASC`,
		)
		.all(params) as ObservationRow[];
	return rows.map(rowToObservation);
}

export function writeObservation(
	o: Omit<Observation, "id" | "ingestedAt"> & { readonly id?: string },
	ingestedAt: string,
): Observation {
	const id = o.id ?? randomUUID();
	getDb()
		.query(
			`INSERT INTO observations (${COLUMNS})
       VALUES ($id, $node, $src, $ext, $kind, $thread, $dir, $at, $title, $excerpt, $url, $actors, $facts, $hash, $ing)
       ON CONFLICT(source_id, external_id) DO UPDATE SET
         node_id = $node, kind = $kind, thread_key = $thread, direction = $dir, occurred_at = $at,
         title = $title, excerpt = $excerpt, url = $url, actors_json = $actors, facts_json = $facts,
         content_hash = $hash, ingested_at = $ing`,
		)
		.run({
			$id: id,
			$node: o.nodeId,
			$src: o.sourceId,
			$ext: o.externalId,
			$kind: o.kind,
			$thread: o.threadKey ?? null,
			$dir: o.direction ?? null,
			$at: o.occurredAt,
			$title: o.title,
			$excerpt: o.excerpt ?? null,
			$url: o.url ?? null,
			$actors: JSON.stringify(o.actors),
			$facts: JSON.stringify(o.facts),
			$hash: o.contentHash,
			$ing: ingestedAt,
		});
	return findObservation(o.sourceId, o.externalId) as Observation;
}

/** Observations in a thread, oldest first. */
export function listThreadObservations(
	threadKey: string,
	limit = 50,
): Observation[] {
	const rows = getDb()
		.query(
			`SELECT ${COLUMNS} FROM (
         SELECT ${COLUMNS} FROM observations WHERE thread_key = $t ORDER BY occurred_at DESC LIMIT $limit
       ) ORDER BY occurred_at ASC`,
		)
		.all({ $t: threadKey, $limit: Math.max(1, limit) }) as ObservationRow[];
	return rows.map(rowToObservation);
}

/**
 * Observations written or changed at or after `since`, oldest first (ties by
 * id). With `afterId`, rows at exactly `since` resume after that id, so a
 * caller can page through more than `limit` rows that share an ingest time.
 */
export function listIngestedSince(
	since: string,
	limit = 2000,
	afterId?: string,
): Observation[] {
	const rows = getDb()
		.query(
			`SELECT ${COLUMNS} FROM observations
       WHERE ${afterId ? "(ingested_at > $since OR (ingested_at = $since AND id > $after))" : "ingested_at >= $since"}
       ORDER BY ingested_at ASC, id ASC LIMIT $limit`,
		)
		.all({
			$since: since,
			$limit: Math.max(1, limit),
			...(afterId ? { $after: afterId } : {}),
		}) as ObservationRow[];
	return rows.map(rowToObservation);
}

export function listAllObservations(limit = 100_000): Observation[] {
	const rows = getDb()
		.query(
			`SELECT ${COLUMNS} FROM observations ORDER BY occurred_at ASC LIMIT $limit`,
		)
		.all({ $limit: Math.max(1, Math.min(500_000, limit)) }) as ObservationRow[];
	return rows.map(rowToObservation);
}

/** Recent event-time observations used to schedule an unanswered-thread reevaluation. */
export function listObservationsOccurredSince(
	since: string,
	limit = 5000,
): Observation[] {
	const rows = getDb()
		.query(`SELECT ${COLUMNS} FROM (
			SELECT ${COLUMNS} FROM observations WHERE occurred_at >= $since ORDER BY occurred_at DESC LIMIT $limit
		) ORDER BY occurred_at ASC`)
		.all({
			$since: since,
			$limit: Math.max(1, Math.min(50_000, limit)),
		}) as ObservationRow[];
	return rows.map(rowToObservation);
}

/** Old observations whose nodes are not cited as evidence by any loop. */
export function listPrunableObservations(
	cutoff: string,
	limit = 1000,
): Observation[] {
	const rows = getDb()
		.query(
			`SELECT ${COLUMNS} FROM observations o
       WHERE o.occurred_at < $cutoff AND o.ingested_at < $cutoff
         AND NOT EXISTS (
           SELECT 1 FROM graph_edges e
           JOIN followup_loops l ON l.loop_id = e.src
           WHERE e.type = 'evidence_for' AND e.dst = o.node_id AND l.status = 'open'
         )
       LIMIT $limit`,
		)
		.all({ $cutoff: cutoff, $limit: limit }) as ObservationRow[];
	return rows.map(rowToObservation);
}

export function deleteObservation(id: string): void {
	getDb().query("DELETE FROM observations WHERE id = $id").run({ $id: id });
}

// ── Cursors ───────────────────────────────────────────────────────────

export interface SourceSelf {
	readonly emails: readonly string[];
	readonly handles: readonly string[];
}

export interface ObservationCursor {
	readonly sourceId: string;
	readonly since?: string;
	readonly lastRunAt?: string;
	readonly lastSuccessAt?: string;
	readonly lastError?: string;
	readonly self: SourceSelf;
	readonly ingestedCount: number;
}

type CursorRow = {
	source_id: string;
	since: string | null;
	last_run_at: string | null;
	last_success_at: string | null;
	last_error: string | null;
	self_json: string;
	ingested_count: number;
};

function rowToCursor(r: CursorRow): ObservationCursor {
	const self = JSON.parse(r.self_json) as Partial<SourceSelf>;
	return {
		sourceId: r.source_id,
		...(r.since ? { since: r.since } : {}),
		...(r.last_run_at ? { lastRunAt: r.last_run_at } : {}),
		...(r.last_success_at ? { lastSuccessAt: r.last_success_at } : {}),
		...(r.last_error ? { lastError: r.last_error } : {}),
		self: { emails: self.emails ?? [], handles: self.handles ?? [] },
		ingestedCount: r.ingested_count,
	};
}

export function getCursor(sourceId: string): ObservationCursor | null {
	const row = getDb()
		.query("SELECT * FROM observation_cursors WHERE source_id = $s")
		.get({ $s: sourceId }) as CursorRow | undefined;
	return row ? rowToCursor(row) : null;
}

export function listCursors(): ObservationCursor[] {
	const rows = getDb()
		.query("SELECT * FROM observation_cursors ORDER BY source_id")
		.all() as CursorRow[];
	return rows.map(rowToCursor);
}

export function recordCursorSuccess(
	sourceId: string,
	params: {
		readonly since: string;
		readonly at: string;
		readonly self?: SourceSelf;
		readonly ingested: number;
	},
): void {
	getDb()
		.query(
			`INSERT INTO observation_cursors (source_id, since, last_run_at, last_success_at, last_error, self_json, ingested_count)
       VALUES ($s, $since, $at, $at, NULL, $self, $n)
       ON CONFLICT(source_id) DO UPDATE SET since = $since, last_run_at = $at, last_success_at = $at,
         last_error = NULL, self_json = COALESCE($selfOrNull, self_json), ingested_count = ingested_count + $n`,
		)
		.run({
			$s: sourceId,
			$since: params.since,
			$at: params.at,
			$self: JSON.stringify(params.self ?? { emails: [], handles: [] }),
			$selfOrNull: params.self ? JSON.stringify(params.self) : null,
			$n: params.ingested,
		});
}

export function recordCursorError(
	sourceId: string,
	error: string,
	at: string,
): void {
	getDb()
		.query(
			`INSERT INTO observation_cursors (source_id, last_run_at, last_error)
       VALUES ($s, $at, $e)
       ON CONFLICT(source_id) DO UPDATE SET last_run_at = $at, last_error = $e`,
		)
		.run({ $s: sourceId, $at: at, $e: error.slice(0, 500) });
}

/** Every identity the user has across sources (lowercased emails, raw handles). */
export function allSelfIdentities(): SourceSelf {
	const emails = new Set<string>();
	const handles = new Set<string>();
	for (const c of listCursors()) {
		for (const e of c.self.emails) emails.add(e.trim().toLowerCase());
		for (const h of c.self.handles) handles.add(h);
	}
	return { emails: [...emails], handles: [...handles] };
}
