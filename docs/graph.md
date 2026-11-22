# Knowledge graph

The property graph in `memory.sqlite` links memories, source observations,
people, threads, projects, topics, events, todos, and follow-up loops.
Implementation: [`packages/core/src/graph/`](../packages/core/src/graph/).
The graph is local derived context, not a replacement for integration data.

## Storage and writes

`graph_nodes` has a unique `(type, key)`, JSON properties, visibility,
sensitivity, optional reference to a source row, and timestamps.
`graph_edges` has unique `(src, dst, type)` relationships, weight, confidence,
origin, provenance, an optional evidence reason, and occurrence count.
Adjacency indexes cover both directions. `graph_embeddings`,
`graph_enrich_queue`, and `graph_meta` hold vectors, retry work, and budgets.
Schema creation and upgrades live in `memory/memory-store.ts`.

`writeGraph({ nodes, edges, enrich })` upserts endpoints and deterministic
edges transactionally. Identical writes converge on stable node and edge IDs.
People use normalized email addresses or source/workspace-scoped handles.
`alias_of` links express possible duplicates without destructively merging
nodes. Memory save/update/merge/forget hooks use the same database transaction;
forget removes the graph node, adjacency, embedding, and queued enrichment.
Forgetting or restricting visibility also removes the memory's activity-ledger
copy and its graph node. Memory observation copies carry the memory's expiry.
Existing memories are backfilled once.

## Enrichment

- Deterministic edges link authors, recipients, threads, attendees when
  supplied, memory subjects, and todos to their loops.
- Semantic `related_to` edges use the configured memory embedder. Each
  node gets at most five matches above `graph.semanticThreshold` (default
  `0.8`), against observations from the last 45 days and all usable memories.
  Memory nodes reuse `memory_embeddings`. Re-embedding removes stale links.
- Extraction uses the follow-up evaluator with schema-constrained output.
  Entities and links require confidence of at least `0.7`; unknown input IDs
  are ignored. Extraction works without an embedding provider.
  `graph.maxExtractionsPerDay` defaults to 300 nodes per UTC day.
  Over-budget nodes retain deterministic and semantic relationships.

The worker drains up to 100 queued nodes per run, extracts batches of eight,
and backs off failures. Private and confirmation-required nodes are not
submitted for enrichment.

## Traversal and privacy

`neighbors(ids, options)` walks indexed adjacency in both directions, up to
three hops, with edge/type/weight/confidence filters, per-node fanout bounds,
and an output limit. The implementation uses a bounded breadth-first walk,
so visibility is checked before expanding each hop. Hidden nodes cannot
bridge two visible nodes. Expired memories are excluded too.
`contextFor(ids, { maxChars, nodeFilter, ... })` renders a bounded prompt
subgraph. Follow-ups also filter disabled sources from this context.

`GET /api/graph/nodes/:id/neighbors?depth=2&limit=100` is an inspection endpoint.
Private or unavailable starting nodes return 404. `POST /api/graph/rebuild`
re-derives graph nodes/edges and queues enrichment from stored rows.
Chat's `graphNeighbors(entity)` resolves an entity and returns visible context.

## Retention and performance

Observation retention is described in [observations.md](observations.md).
The graph and loop ledger are local; todo sync carries todos, not the graph.

Run the isolated synthetic benchmark from the repository root:

```sh
bun apps/cli/scripts/bench-graph-performance.ts
```

A fresh Bun process on the development Mac measured 50,000 nodes and 300,000
edges, with six forward ring neighbors per node:

| Operation | Time |
| --- | --- |
| Fresh schema startup | 9.06 ms |
| Seed dataset | 466.13 ms |
| First two-hop query, limit 100 (24 results) | 1.07 ms |
| First `writeGraph`, 500 nodes / 3,000 edges | 11.15 ms |

Final counts were 50,500 nodes and 303,000 edges. These timings describe this
synthetic topology, not a dense mailbox graph or model/enrichment latency.
The script creates and cleans a temporary `TOBY_DIR`; it never uses live data.

See [followups.md](followups.md) for the graph's first consumer.
