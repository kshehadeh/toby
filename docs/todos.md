# Toby Todos

Toby Todos is Toby's built-in todo system. It needs no plugin or external
account. Chat, Flows, the native **Todos** workspace, project details, and the
Home card all use the same service, so a change made in one place appears
everywhere.

Code lives in [`packages/core/src/todos/`](../packages/core/src/todos/) and the
shared tool registry in
[`packages/core/src/core-tools/`](../packages/core/src/core-tools/index.ts).
Toby.app owns presentation and macOS notification scheduling only
(`apps/toby-app/Sources/TobyApp/Features/Todos/`, `Stores/TodosStore.swift`,
`Stores/TodoNotificationScheduler.swift`).

## Scope

Included: title, description, priority, optional due date and time, one list
(default **Inbox**), multiple tags, an optional Toby project link, a simple
ordered checklist, reminders, common recurrence, completion history, recoverable
deletion, backups, and cross-Mac sync.

Not included: collaboration, nested subtasks, dependencies, advanced calendar
rules, or syncing/importing external task providers. Creating a todo records
intent; it does not authorize Toby to perform the task.

## Default routing

Unqualified requests to create, list, update, complete, or remove todos or
tasks use Toby Todos, even when Todoist or Apple Reminders is connected. An
external provider is used only when the user names it or clearly refers to an
item from that provider. Follow-ups keep the provider of the item being
discussed. When several todos match, the model asks with `askUser` instead of
guessing. Toby never copies todos between providers.

The policy text is `TODO_POLICY` in `core-tools/index.ts`. `run-turn.ts` merges
the core chat tools into every turn (they need no connected integration) and
`injectTodoPolicy` appends the policy to the first system message. The Todoist
plugin prompt only claims requests that explicitly mention Todoist.

## Data model

All shared state is in `chat.sqlite`:

| Table | Contents |
| --- | --- |
| `todo_entities` | One row per `todo`, `occurrence`, `list`, or `tag` entity. Each field is a register `{ value, stamp }`. |
| `todo_operations` | Append-only journal of every mutation (`id`, `replica`, Lamport `clock`, `at`, `source`, `changes`). |
| `todo_requests` | Idempotency keys with an input fingerprint and the stored result. |
| `todo_local` | The local Lamport clock. |

Machine-local state is kept outside `chat.sqlite`, so restoring another Mac's
backup never clones it:

| Path | Contents |
| --- | --- |
| `~/.toby/todo-replica` | This Mac's replica ID. |
| `~/.toby/todo-device.sqlite` | Sync cursors: downloaded batch names, published operation IDs, last success, last error. |
| App `UserDefaults` | Notification enablement and the per-Mac delivery ledger. |

A todo **definition** holds series fields. Each **occurrence** (`<todoId>:<sequence>`)
holds its due date, overrides, and lifecycle state (`open`, `completed`,
`skipped`, with a snapshot of the fields, checklist, tags, and deadline at
closing time). Checklist items, tag memberships, and reminders are stored as
separate keys (`check:<id>`, `tag:<id>`, `reminder:<id>`) so concurrent edits to
different items merge.

Lists and tags are entities with a `deleted` tombstone. Deleting a list moves
its todos to Inbox when they are read; deleting a tag hides the membership.
Neither rewrites every todo, so a deletion stays small. Inbox cannot be renamed
or deleted. Deleting a local project clears `projectId` and `projectLabel` on
linked todos; a project ID that does not exist on this Mac is kept and shown
with its label.

## Recurrence

[`recurrence.ts`](../packages/core/src/todos/recurrence.ts) supports daily,
weekly, selected weekdays, monthly, yearly, positive intervals, and
"N days/weeks/months after completion", with an optional end date.

- Date-only due dates are separate from timed deadlines. Timed deadlines carry
  an IANA timezone and keep their wall-clock time.
- A date-only todo becomes overdue after its calendar day ends.
- Monthly and yearly repeats keep their original anchor: January 31 repeats on
  February's last day and then March 31.
- DST gaps move forward by the gap; repeated times use the earlier instant.
- There is one open occurrence per series. Completing or skipping advances to
  the next future slot, so missed repeats never build a backlog, and completing
  early does not recreate the current slot.
- Successor IDs are deterministic (`id:sequence + 1`), so a retry or a
  simultaneous completion on two Macs converges on one successor.
- Reopen works on the latest closed occurrence while its successor is untouched.
  Otherwise it returns `later_work` rather than rewriting history.
- Edits take a `scope`: `occurrence` (the default) or `series`.

## API

All routes are under `/api/todos` and are handled by
[`web/handlers/todos.ts`](../packages/core/src/web/handlers/todos.ts).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/todos` | Search and filter: `query`, `status` (`open`, `completed`, `all`, `deleted`), `listId`, `tagId`, `projectId`, `priority`, `dueFrom`, `dueTo`, `limit` (≤200), `offset`. Returns `{ todos, total }`. |
| `GET` | `/api/todos/:id` | One todo (current occurrence, or `?sequence=`). |
| `GET` | `/api/todos/:id/history` | Raw journal operations (`history`) and flattened field edits (`entries`) with `current` and `restorable` flags. |
| `GET` | `/api/todos/lists`, `/api/todos/tags` | Organization items (Inbox first). |
| `GET` | `/api/todos/tools` | Flow catalog entries for the core tools. |
| `POST` | `/api/todos/actions/:action` | Run a core tool (`create`, `update`, `complete`, `skip`, `reopen`, `delete`, `restore`, `setTag`, `setChecklistItem`, `setReminder`, `saveLists`, `saveTags`, `restoreField`, …). `Idempotency-Key` and `If-Match` headers map to `idempotencyKey` and `expectedRevision`. |
| `GET` | `/api/todos/reminders/schedule` | Upcoming reminder instants for the native scheduler; empty while paused after a restore. |
| `GET` / `POST` | `/api/todos/sync` | Sync status (`pausedForRestore`, `lastSuccess`, `error`, `pending`); `POST` runs one exchange now. |
| `POST` | `/api/todos/reconcile` | Resume sync after a restore. Requires `{ "confirmMerge": true }`. |

Errors return `{ error, code }` with a 4xx status. Common codes:
`revision_conflict`, `idempotency_conflict`, `incomplete_checklist`,
`due_required`, `time_required`, `later_work`, `not_found`.

## Core tools

Each operation is defined once in `core-tools/index.ts` with its schema,
read-only flag, and executor. Chat uses `chatName`; Flows use
`{ "coreTool": "todos.<id>" }`.

| Flow reference | Chat tool |
| --- | --- |
| `todos.list`, `todos.get` | `listTobyTodos`, `getTobyTodo` |
| `todos.create`, `todos.update` | `createTobyTodo`, `updateTobyTodo` |
| `todos.complete`, `todos.skip`, `todos.reopen` | `completeTobyTodo`, `skipTobyTodo`, `reopenTobyTodo` |
| `todos.delete`, `todos.restore` | `deleteTobyTodo`, `restoreTobyTodo` |
| `todos.setTag`, `todos.setChecklistItem`, `todos.setReminder` | `setTobyTodoTag`, `setTobyTodoChecklistItem`, `setTobyTodoReminder` |
| `todos.lists`, `todos.tags`, `todos.saveLists`, `todos.saveTags` | `listTobyTodoLists`, `listTobyTodoTags`, `saveTobyTodoList`, `saveTobyTodoTag` |
| `todos.history`, `todos.restoreField` | `getTobyTodoHistory`, `restoreTobyTodoField` |
| `todos.summary` | `getTobyTodosSummary` |

Every mutation accepts `idempotencyKey`, `expectedRevision`, and `dryRun`.
Reusing a key with different input is an error. Completing a todo with
unchecked checklist items requires `allowIncompleteChecklist: true`. Lifecycle
tools require the occurrence `sequence` returned by `get` or `list`, so a retry
never advances a later occurrence. Flow steps use the key
`flow:<runId>:<nodeId>`, so retrying a step does not repeat it, while a new run
is a new operation.

`create` also accepts `remind: true`, which attaches the `due` reminder
(`offsetMinutes: 0`, notification at the due date/time) inside the same
operation, so a chat request to be reminded cannot lose its reminder to a
failed follow-up call. It requires a due date with a time (`time_required`
otherwise).

Restoring a field from history (`restoreField`) applies the old value as a new
edit; it never rewrites the journal. Definition fields restore with series
scope; fields stored on the current occurrence restore with occurrence scope.

## Sync

Todos sync through the existing Sync and Backup destination and password, in a
separate namespace:

```
<sync destination>/todos/v1/<replica>/<batch uuid>.json
```

Each file is an immutable, encrypted batch of operations (AES-256-GCM with a
scrypt key, the same primitives as settings sync, with its own envelope
`toby.todos.operations.encrypted`). Batches hold up to 2,048 operations and
900 KB of operation JSON. Files are written atomically and never overwritten.
On iCloud Drive the daemon uses coordinated reads and writes through
`/api/native/icloud/todos/{list,read,write}`.

[`sync.ts`](../packages/core/src/todos/sync.ts) pulls before it pushes. Each
downloaded file is authenticated and validated before any of it is applied, and
it is applied in one transaction. Wrong passwords, corrupt or unknown files,
and unavailable folders leave local todos unchanged and set the status error.
The daemon runs `runTodoSyncLoop` separately from data backups, with backoff
between 5 and 60 seconds. A change of `TOBY_DIR`, destination, or sync
enablement aborts an exchange in progress.

Merge rules:

- Every field register uses a Lamport stamp `clock:replica:operationId`; the
  highest stamp wins. Wall-clock time is not used.
- Different fields merge independently. Checklist items, tags, and reminders
  merge per item.
- Losing values remain in the journal and appear as restorable history entries.
- Deletion is an ordinary field that ordinary edits do not reset; only an
  explicit restore revives a todo.
- Operations arriving out of order are kept, but a todo stays hidden until its
  create operation arrives.
- Tombstones and the journal are never pruned in v1.

## Backup and restore

Todo tables are in `chat.sqlite`, so full backups and automatic data backups
include them. Settings-only backups do not. Restoring databases calls
`pauseTodosAfterRestore()` before the swap. While paused, todo sync and
reminder scheduling stop and the restored snapshot is kept as is. After the
user confirms in Settings → Sync and Backup (or `POST /api/todos/reconcile`),
the per-destination cursors reset and the next exchange merges the restored
journal with the destination. Missed reminders are not replayed.

## Notifications

Toby.app's `TodoNotificationScheduler` reads `/api/todos/reminders/schedule`
and schedules `UNUserNotificationCenter` requests with stable occurrence and
reminder identifiers. It reconciles on launch, on wake, on app activation, and
after todo changes, and cancels requests that are no longer needed. Flows and
Todos share one notification delegate and category registry
(`NativeNotificationCoordinator`). Reminder actions are **Open**, **Complete**,
and **Snooze 10 minutes**; snoozing sets `snoozedUntil` and never changes the
due date.

Enablement is per Mac and requested through **Settings → Sync and Backup →
Todo reminders on this Mac**. Date-only todos need an absolute reminder time;
Toby never invents a midnight alert. Missed reminders produce one catch-up
summary. Already scheduled alerts can fire while Toby is closed, but changes
that have not reached this Mac cannot be scheduled, and Focus or macOS
notification settings may silence alerts.

## Home and projects

The built-in flow `dashboard.todos.summary` ("Toby Todos") runs
`{ coreTool: "todos.summary" }` and shows open, overdue, and due-today counts on
Home with links (`toby://todos/<id>`) that open the todo. It needs no AI call.
Project details show linked open todos and a **New todo** action that
pre-fills the project.

## Scale

Measured on an Apple silicon Mac with a synthetic dataset of 10,000 todos and
100,000 operations in an isolated `TOBY_DIR`, each phase in a fresh process:

| Measurement | Result |
| --- | --- |
| First page of 50 (fresh process) | ~250 ms |
| Page at offset 5,000 / text search | ~240 ms / ~220 ms |
| Home summary | ~470 ms |
| Initial publish of 100,000 operations | 5.7 s, 51 files, 37.6 MB |
| Bootstrap pull on a second Mac | 5.2 s |
| One incremental edit | 757 bytes up, 757 bytes down, ~0.1–0.2 s |
| Peak memory | ~430 MB RSS |

Queries currently rebuild each todo from its entity rows, so list time grows
linearly with the number of todos.

## Tests

- `apps/cli/tests/todos.test.ts` — domain rules, recurrence, tool adapters, Flow execution
- `apps/cli/tests/todo-sync.test.ts` — multi-replica merge, delivery order, conflicts, restore
- `apps/cli/tests/todo-backup-reminders.test.ts` — backup round trip, reminders, project unlink
- `apps/toby-app/Tests/TobyAppTests/Todo*Tests.swift` — workspace, detail actions, notifications, Flow picker, native sync bridge
