# Source observations

[`packages/core/src/observations/`](../packages/core/src/observations/) collects
bounded activity snapshots into `memory.sqlite`. Each observation has a
stable source/external ID, kind, occurrence time, ingestion time, content hash,
optional thread/direction/URL, actors, facts, and a short excerpt.
Stored excerpts are capped at 2,000 UTF-8 bytes without splitting characters.
`observations` is the ledger; `observation_cursors` stores per-source progress,
last success, ingestion count, and error.

## Plugin extension point

Tag a read-only tool with `standardTool: "activity.recent"`. Core discovers all
connected plugins with this tag, without a plugin-specific registry edit.
The normal plugin execution envelope puts this payload in `result`:

```ts
// Input
{ since: string; limit?: number } // ISO 8601; default 200

// Output
{
  observations: [{
    externalId: string,
    kind: string, // e.g. email.message
    occurredAt: string,
    title: string,
    threadId?: string,
    direction?: "inbound" | "outbound",
    excerpt?: string,
    url?: string,
    actors: [{
      role: "from" | "to" | "cc" | "attendee" | "organizer" | "mentioned" | "author",
      name?: string, email?: string, handle?: string, scope?: string
    }],
    facts?: Record<string, string | number | boolean>
  }],
  self?: { emails?: string[], handles?: string[] }
}
```

See `types.ts` for exact Zod limits. Batches are capped at 1,000 observations.
Invalid items are logged and skipped individually. Plugins should return
newest relevant activity first, respect the time/limit, and honor dry-run.

## Shipped sources

| Source ID | Data |
| --- | --- |
| `plugin:email` | Received and sent mail, to/cc actors, normalized thread roots, snippets, bulk/no-reply flags, and self addresses |
| `plugin:slack` | Mentions, DMs, and the user's own recent messages, with team-scoped actors |
| `calendar` | Upcoming `calendar.upcomingSummary` events, notes, location, and event facts |
| `memory` | Usable-by-AI memory context, evidence-only |
| `toby.chat` | User turns from local Toby chats, evidence-only; external inbound sessions excluded |
| `toby.todos` | Changed Toby Todos, evidence-only |

All shipped sources default on. Calendar attendees can only be linked when
the source supplies stable actor identifiers; the summary adapter currently
has attendee counts, not attendee identities.

## Ingest and lifecycle

Ingest hashes normalized content and skips unchanged rows. Changed content
updates the same node. The ledger write and graph write share a transaction.
Deterministic edges connect actors, threads, and events; graph enrichment adds
semantic/extracted context asynchronously.

Sources have independent cursors. Failures are logged and do not stop other
sources. Follow-up source overrides disable collection and prompt inclusion.
Old observations are pruned after 45 days unless an open loop cites them.
Resolved-loop evidence can be pruned. Reconciliation runs before pruning.
Memory updates discard stale activity copies when text or expiry changes;
forgetting or restricting visibility removes the copy and its graph node.
Memory observation copies inherit expiry and are excluded from prompts after
that time.

Observations do **not** automatically create durable memories. That extraction
is outside this feature. See [graph.md](graph.md) and [followups.md](followups.md).
