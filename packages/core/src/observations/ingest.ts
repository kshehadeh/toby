import { createHash } from "node:crypto";
import { emailPersonKey, normalizeEmail, threadKey } from "../graph/keys";
import type {
	GraphEdgeInput,
	GraphEnrichStep,
	GraphNodeInput,
	GraphNodeType,
} from "../graph/types";
import { writeGraph } from "../graph/write";
import { getDb } from "../memory/memory-store";
import { type SourceSelf, findObservation, writeObservation } from "./store";
import {
	EXCERPT_MAX_BYTES,
	type Observation,
	type ObservationActor,
	type ObservationInput,
} from "./types";

export type IngestStatus = "new" | "updated" | "unchanged";

export interface IngestResult {
	readonly status: IngestStatus;
	readonly observation: Observation;
}

const NODE_TEXT_MAX = 500;
/** Weight of a cc edge relative to a direct (to) edge. */
const CC_WEIGHT = 0.6;

function boundedExcerpt(text: string): string {
	const bytes = Buffer.from(text, "utf8");
	if (bytes.length <= EXCERPT_MAX_BYTES) return text;
	let end = EXCERPT_MAX_BYTES;
	while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
	return bytes.subarray(0, end).toString("utf8");
}

/** Graph node type for an observation kind; most kinds are plain observations. */
export function nodeTypeForKind(kind: string): GraphNodeType {
	if (kind === "calendar.event") return "event";
	if (kind === "todo.item") return "todo";
	return "observation";
}

/** Todos keep their todo id as key so loops and ingest share one node. */
export function nodeKeyFor(sourceId: string, input: ObservationInput): string {
	return nodeTypeForKind(input.kind) === "todo"
		? input.externalId
		: `${sourceId}:${input.externalId}`;
}

function sortedFacts(
	facts: ObservationInput["facts"],
): Record<string, string | number | boolean> {
	const out: Record<string, string | number | boolean> = {};
	for (const key of Object.keys(facts ?? {}).sort()) {
		const v = facts?.[key];
		if (v !== undefined) out[key] = v;
	}
	return out;
}

/**
 * Read/flag state that changes whenever the user opens mail. Kept on the
 * observation but left out of its hash, so reading an email doesn't re-ingest
 * it and re-spend follow-up evaluation budget.
 */
const VOLATILE_FACT_KEYS = new Set(["seen", "answered", "flagged"]);

function hashedFacts(
	facts: ObservationInput["facts"],
): Record<string, string | number | boolean> {
	const out = sortedFacts(facts);
	for (const key of VOLATILE_FACT_KEYS) delete out[key];
	return out;
}

export function observationContentHash(input: ObservationInput): string {
	return createHash("sha256")
		.update(
			JSON.stringify([
				input.kind,
				input.title,
				input.excerpt ?? "",
				input.direction ?? "",
				input.threadId ?? "",
				input.occurredAt,
				hashedFacts(input.facts),
				input.actors.map((a) => [a.role, a.email ?? "", a.handle ?? ""]),
			]),
		)
		.digest("hex");
}

function isSelfActor(actor: ObservationActor, self: SourceSelf): boolean {
	if (actor.email && self.emails.includes(normalizeEmail(actor.email)))
		return true;
	return actor.handle !== undefined && self.handles.includes(actor.handle);
}

/** Person node for an actor; null when it carries no stable identifier. */
export function personNodeFor(
	sourceId: string,
	actor: ObservationActor,
	self: SourceSelf,
): GraphNodeInput | null {
	const email = actor.email?.trim();
	let key: string | null = null;
	if (email?.includes("@")) key = emailPersonKey(email);
	else if (actor.handle)
		key = `handle:${sourceId}:${actor.scope ?? ""}:${actor.handle}`;
	if (!key) return null;
	const label = actor.name?.trim() || email || actor.handle || key;
	return {
		type: "person",
		key,
		label,
		props: {
			...(email ? { email: normalizeEmail(email) } : {}),
			...(isSelfActor(actor, self) ? { self: true } : {}),
		},
	};
}

/** Infer direction from the author when the source didn't say. */
function inferDirection(
	input: ObservationInput,
	self: SourceSelf,
): "inbound" | "outbound" | undefined {
	if (input.direction) return input.direction;
	const author = input.actors.find(
		(a) => a.role === "from" || a.role === "author",
	);
	if (!author) return undefined;
	return isSelfActor(author, self) ? "outbound" : "inbound";
}

function enrichStepsFor(input: ObservationInput): GraphEnrichStep[] {
	if (input.kind === "todo.item") return ["embed"];
	if (input.facts?.bulk === true) return ["embed"];
	return ["embed", "extract"];
}

/**
 * Store one observation and link it into the graph: author/recipients as
 * people, its thread, and mentions. Unchanged content is a no-op, so
 * re-fetching an overlapping window costs nothing.
 */
export function ingestObservation(
	sourceId: string,
	raw: ObservationInput,
	self: SourceSelf,
	now = new Date(),
	options: { readonly force?: boolean } = {},
): IngestResult {
	const input: ObservationInput = {
		...raw,
		...(raw.excerpt ? { excerpt: boundedExcerpt(raw.excerpt) } : {}),
	};
	const hash = observationContentHash(input);
	const existing = findObservation(sourceId, input.externalId);
	if (!options.force && existing && existing.contentHash === hash) {
		return { status: "unchanged", observation: existing };
	}

	const direction = inferDirection(input, self);
	const tKey = input.threadId ? threadKey(sourceId, input.threadId) : undefined;
	const facts = sortedFacts(input.facts);
	const node: GraphNodeInput = {
		type: nodeTypeForKind(input.kind),
		key: nodeKeyFor(sourceId, input),
		label: input.title.slice(0, 200) || input.kind,
		props: {
			kind: input.kind,
			sourceId,
			occurredAt: input.occurredAt,
			...(direction ? { direction } : {}),
			...(input.url ? { url: input.url } : {}),
			text: (input.excerpt ?? "").slice(0, NODE_TEXT_MAX),
			...facts,
		},
	};

	const edges: GraphEdgeInput[] = [];
	if (tKey) {
		edges.push({
			src: node,
			dst: { type: "thread", key: tKey, label: input.title.slice(0, 200) },
			type: "in_thread",
		});
	}
	for (const actor of input.actors) {
		const person = personNodeFor(sourceId, actor, self);
		if (!person) continue;
		switch (actor.role) {
			case "from":
			case "author":
				edges.push({ src: person, dst: node, type: "sent" });
				break;
			case "to":
				edges.push({ src: node, dst: person, type: "received" });
				break;
			case "cc":
				edges.push({
					src: node,
					dst: person,
					type: "received",
					weight: CC_WEIGHT,
				});
				break;
			case "attendee":
			case "organizer":
				edges.push({ src: person, dst: node, type: "attends" });
				break;
			case "mentioned":
				edges.push({ src: node, dst: person, type: "mentions" });
				break;
		}
	}

	// A forced replay (graph rebuild) of unchanged content keeps its ingest
	// time, so it doesn't look new to follow-up evaluation.
	const ts =
		existing && existing.contentHash === hash
			? existing.ingestedAt
			: now.toISOString();
	const db = getDb();
	const write = db.transaction(() => {
		const { nodeIds } = writeGraph({
			nodes: [node],
			edges,
			enrich: enrichStepsFor(input),
		});
		return writeObservation(
			{
				...(existing ? { id: existing.id } : {}),
				nodeId: nodeIds[0] as string,
				sourceId,
				externalId: input.externalId,
				kind: input.kind,
				...(input.threadId ? { threadId: input.threadId } : {}),
				...(tKey ? { threadKey: tKey } : {}),
				...(direction ? { direction } : {}),
				occurredAt: input.occurredAt,
				title: input.title,
				...(input.excerpt ? { excerpt: input.excerpt } : {}),
				...(input.url ? { url: input.url } : {}),
				actors: input.actors,
				facts,
				contentHash: hash,
			},
			ts,
		);
	});
	return { status: existing ? "updated" : "new", observation: write() };
}
