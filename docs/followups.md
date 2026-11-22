# Automatic follow-ups

Toby creates built-in todos in **From Toby**, tagged **auto**, when connected
activity shows a reply obligation, an unanswered outbound request, or a
concrete commitment. A structured-output evaluator makes every opening and
closing decision. Code only selects candidates, applies thresholds, enforces
budgets, and reconciles user actions.

Implementation: [`packages/core/src/followups/`](../packages/core/src/followups/).
See [graph.md](graph.md), [observations.md](observations.md), and
[todos.md](todos.md).

## Run pipeline

The daemon waits one minute after startup, then checks every 30 minutes during
the Feed's active hours. A manual check bypasses that schedule.

1. Backfill memories and ingest enabled sources.
2. Reconcile user actions, prune stale observations, and drain graph enrichment.
3. Build opening units from changed source activity and waiting email threads.
   Nearby open loops become closing units through shared people, threads,
   projects/topics, or semantic links. Loop links copy evidence relationships,
   so completion candidates are reachable within two hops.
4. Skip bulk/no-reply/automated-only opening candidates and unchanged hashes.
   Unanswered outbound mail is reconsidered when its wait window elapses,
   bounded to 45 days and the newest 5,000 observations.
5. Evaluate batches of eight. Ignore unknown IDs. Missing units remain unjudged
   and their budget is refunded; malformed output fails the run.
6. Open/resolve qualifying loops, create/complete todos, and send a quiet
   completion summary when enabled.

The model uses examples for `owe_reply`, `awaiting_reply`, and `commitment`.
Prompt context includes source evidence, identities, usable memories,
relationships, upcoming events, settings, and user instructions.
Model calls require schema-constrained output, with no free-text fallback.
An explicit evaluator must be configured and support structured output.
Automatic selection tries the auxiliary model, then the Feed model, or returns
`setup_required`. The same evaluator extracts graph entities. Token usage is
logged as `followup_model_usage`.

## Loops and user control

Loops are graph nodes plus `followup_loops` rows, with statuses
`open`, `resolved`, `dismissed`, or `expired`. `evidence_for` edges record the
source and reason; a todo's `tracks` edge points to the loop.
Fingerprints include the unit and evidence hash. Todo IDs derive from the
fingerprint, and `followup:<loopId>` is the creation idempotency key.
Matching active loops collect new evidence without duplicating their todo.
New evidence after resolution can create a fresh loop.

Todo descriptions contain a short explanation and source URL, not message
bodies. Model-supplied deadlines become UTC todo deadlines.
Automatic completion uses the current todo revision.

- User completion resolves the loop.
- Deletion or **Not useful** dismisses it and records feedback.
- **Reopen**, including a generic/synced reopen of an auto-completed todo,
  marks resolution rejected. Closing again requires evidence both occurring
  and ingested after the reopen time.
- Open loops expire after 30 days without evidence activity. Repeated
  evaluation alone does not extend activity; late-ingested old evidence does
  not advance its occurrence time. Reconciliation checks recent linked
  activity before expiry, and user completion/deletion takes precedence.
- With `autoComplete: false`, the loop still resolves and records evidence,
  but its todo stays open and no completion notification is sent.

Todos use existing merge-safe sync. The graph/loop ledger is local.
Creating a todo does not authorize executing its task or sending a reply.

## Configuration

Only non-default values are persisted under `followups` and `graph`:

| Key | Default |
| --- | --- |
| `followups.enabled` | `true` |
| `followups.evaluator.{provider,model}` | Automatic eligible auxiliary/Feed model |
| `followups.sources` | Shipped sources enabled |
| `followups.kinds.{oweReply,awaitingReply,commitment}` | All `true` |
| `followups.awaitingReplyDays` | `3` |
| `followups.thresholds.{open,close}` | `0.75`, `0.85` |
| `followups.autoComplete`, `followups.notifications` | `true` |
| `followups.intervalMinutes` | `30` |
| `followups.maxEvaluationsPerDay` | `200` units per UTC day |
| `graph.semanticThreshold` | `0.8` |
| `graph.maxExtractionsPerDay` | `300` nodes per UTC day |

Settings → **Follow-ups** exposes model, sources/status, kinds, wait,
thresholds, completion, notifications, schedule, budget, and instructions.
Save changes before **Check now**. Instructions save independently, with
20 entries and 2,000 characters per entry. The todo inspector shows
**Why Toby added this**, evidence/reasons, **Reopen**, and confirmed **Not useful**.

## HTTP and chat APIs

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/followups` | Up to 500 loops, all statuses |
| GET | `/api/followups/:id` | Loop with evidence, by loop or todo ID |
| GET / PUT / PATCH | `/api/followups/config` | Read/update follow-up and graph settings |
| GET | `/api/followups/sources` | Available sources, defaults, effective state, and cursors |
| POST | `/api/followups/run` | Manual check |
| GET / POST | `/api/followups/instructions` | List/create instructions |
| PATCH / DELETE | `/api/followups/instructions/:id` | Update/delete instruction |
| POST | `/api/followups/:id/reopen` | Reopen a completed todo; 409 otherwise |
| POST | `/api/followups/:id/feedback` | `{ "outcome": "not_useful" }` |

Config PATCH merges nested source/kind/threshold overrides. PUT replaces
supplied nested maps, so an empty source map restores defaults. Null evaluator
fields clear custom selection. Unrelated config remains unchanged.

Manual run responses include `status` (`ok`, `disabled`, `setup_required`,
`error`) and `ingested`, `enriched`, `reconciled`, `candidates`, `evaluated`,
`opened`, `closed`, plus optional `error`. Clients must inspect status, not
just HTTP 200. Chat can call `explainTobyFollowup(todoId)` and
`graphNeighbors(entity)`.

Auto todos already reach The Feed through its todo candidates. Graph-driven
Feed ranking, meeting prep, and observation-to-memory proposals remain out of
scope.
