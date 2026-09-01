# Memory Subsystem

Toby's memory subsystem stores durable, user-relevant personal context for future AI calls. It is **separate** from the tool-call cache and the chat session store — it lives in its own SQLite file (`~/.toby/memory.sqlite`) with its own schema, APIs, and safety policies.

## Core principles

1. **Tool-call cache and user memory are separate concerns.** Memory uses `memory.sqlite`, not `chat.sqlite`.
2. **Raw integration data remains the source of truth.** Memory is derived context, not a replacement for Email, Calendar, etc.
3. **Downstream AIs must not write directly to memory.** All writes go through `memory.propose()`, which enforces the proposal flow.
4. **Every memory item has provenance.** Each item links to one or more `memory_sources` and is tracked in the `memory_audit_log`.
5. **Users can search, inspect, update, and forget memory.** All items are accessible and deletable.
6. **Sensitive memory requires explicit confirmation.** Restricted data (health, politics, religion, sexuality, financial, location, family-sensitive) is never auto-saved.

## Data model

### memory_items

| Column | Type | Description |
| ------ | ---- | ----------- |
| id | TEXT PK | UUID |
| user_id | TEXT | Owner |
| type | TEXT | `preference`, `relationship`, `project`, `life_event`, `fact`, `summary` |
| subject | TEXT | Optional topic label |
| value | TEXT | The memory content |
| confidence | REAL | 0–1 score |
| sensitivity | TEXT | `normal`, `sensitive`, `restricted` |
| visibility | TEXT | `usable_by_ai`, `requires_confirmation`, `private` |
| expires_at | TEXT | Optional expiry |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### memory_sources

Provenance record for where a memory came from (email, calendar, drive, chat, manual, other). Each source can link to the original item via `source_id` / `source_url` and include an `excerpt` and `metadata`.

### memory_proposals

Pending proposals before they become accepted memory. Contains the candidate, confidence, sensitivity, suggested visibility, and reason. Status: `pending` → `accepted` | `rejected`.

### memory_audit_log

Every action (proposed, saved, rejected, updated, forgotten, retrieved) is logged with a timestamp and optional detail JSON.

### memory_embeddings

Reserved for future vector search. Currently stub-ready.

## Proposal flow

```
AI observes data → memory.propose() → policy classifies sensitivity
  ├─ auto-eligible (high-confidence normal preference) → save immediately
  └─ needs review → stays as pending proposal
       ├─ memory.save(proposalId) → creates memory_item
       └─ memory.reject(proposalId) → marks rejected
```

### Auto-save rules

A proposal is auto-saved only when **all** of these are true:

- `sensitivity` is `normal`
- `confidence` >= 0.8
- `type` is `preference` (or `fact` with confidence >= 0.9)

### Sensitivity classification

The policy engine scans the value and subject for keywords:

- **Restricted**: health, mental health, political affiliation, religion, sexuality, precise location, financial details, family-sensitive topics
- **Sensitive**: personal, private, intimate, partner, children, password
- **Normal**: everything else

### Visibility rules

- `restricted` sensitivity → always `requires_confirmation`
- `sensitive` sensitivity → always `requires_confirmation`
- `relationship` type → `requires_confirmation` unless user explicitly stated it
- Normal preferences/facts → `usable_by_ai`

## Retrieval

`retrieveForTask(userId, taskDescription)` returns a compact `MemoryContextBundle`:

- **memories**: items matching the task, ranked by keyword overlap and confidence
- **summary**: short text describing what was found
- **omitted**: count of items excluded due to privacy

`memorySearch` / `search()` tokenizes the query (stopwords removed) and matches **any** remaining term against `value`, `subject`, or `type`. A stuffed phrase such as “where I live home address residence” still finds “Lives in Baltimore, Maryland”. Results are ranked by full-phrase hit, keyword overlap, then confidence.

### System-prompt injection

Each chat turn (and scheduled run) appends a **Known memories** section to the first system message when there is anything to include:

- Only `usable_by_ai` items are listed. `requires_confirmation` and `private` items are omitted (same privacy rules as `retrieveForTask` without `includeUnconfirmed`).
- Expired items (`expires_at` in the past) are omitted.
- The whole section is capped at **20,000 characters**. Newest memories fill the budget first; leftover items are noted so the model can `memorySearch`.
- The section is stripped and rebuilt every turn so saves and forgets show up without starting a new chat.

Implementation: [`packages/core/src/memory/prompt.ts`](../packages/core/src/memory/prompt.ts), injected by [`prepare-messages.ts`](../packages/core/src/prepare-messages.ts).

Retrieval rules:

- Only returns `usable_by_ai` memories by default
- `requires_confirmation` items are included only if `includeUnconfirmed: true`
- `private` items are never returned
- Results are capped at 10 items by default

## Tool interface

Memory is exposed as tools to the AI harness:

| Tool | Description |
| ---- | ----------- |
| `memorySearch` | Search memories by independent keywords (not one exact substring) |
| `memoryPropose` | Propose a new memory (never direct writes) |
| `memorySave` | Confirm a pending proposal |
| `memoryForget` | Delete a memory |
| `memoryExplain` | Show provenance and audit trail |
| `memoryRetrieveForTask` | Get context relevant to a task |

## Native app UI refresh

Toby.app’s `MemoriesStore` keeps the Memories window in sync with writes that happen outside the view (chat tools, schedules, etc.):

1. **Reload on appear** — opening the Memories window always re-fetches the list (not a one-shot cache).
2. **Chat invalidation** — successful `memoryPropose` / `memorySave` / `memoryForget` tool completions post `Notification.Name.memoriesDidChange` (`toby.memoriesDidChange`). The store marks itself dirty and, if the Memories UI is open (polling active), runs a quiet refresh.
3. **Polling** — while the Memories window is visible, the store quietly re-fetches about every 5 seconds.
4. **Manual refresh** — toolbar refresh button forces a full reload with loading indicators.

## File layout

```
src/memory/
  types.ts            # TypeScript types
  memory-store.ts     # SQLite repository layer
  memory-service.ts   # Public API
  policy.ts           # Sensitivity classification + auto-save rules
  prompt.ts           # System-prompt formatting (≤20k, privacy-filtered)
  tools.ts            # AI tool wrappers
```
