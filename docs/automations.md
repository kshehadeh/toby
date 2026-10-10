# Event automations

An automation connects a macOS event, deterministic conditions, and a saved
custom flow. Core matches/claims events and executes flows; Toby.app observes
public OS APIs and exposes the native editor. Existing cron schedules continue
using their current tables, executor, IDs, and CLI/API contracts.

## Supported triggers

| Type | Configuration | Semantics |
| --- | --- | --- |
| `macos.userReturned` | `minimumIdleSeconds`, 10–604800; default 1800 | Physical input resumes after a continuously observed idle interval. Sampling is every five seconds. Idle does not establish absence. |
| `macos.didWake` | None | NSWorkspace system-wake event; not display wake, login, or unlock. |
| `macos.fileChanges` | Absolute folder, recursive flag, extensions, excluded paths, kinds (`new`, `changed`, `deleted`), settlingSeconds (2–60), allowLargeFolder | Settled batches from FSEvents plus snapshot reconciliation. |

The native source uses `CGEventSource.secondsSinceLastEventType` with HID system
state and `NSWorkspace` notifications. It records durations and timestamps,
never input content. A new source initializes a baseline without emitting a
return or backfilling time before observation. Inactive user sessions and
unavailable input readings reset that baseline. Sleep resets the input baseline; wake and resumed input remain separate events.

Toby.app must remain running. Closing its window is fine. Quitting the app
makes the daemon show **Waiting for Toby.app**; the supervisor does not launch
it again. Events during app downtime are missed. Cron schedules keep running.

## Definitions and limits

Definitions contain a trigger, conditions, a flow action, policy, and optional
completion notification. Enabled defaults to false. Conditions are AND:

- Weekdays use Sunday = 0; omitted means every day.
- Time windows use 24-hour `HH:mm`, inclusive start/exclusive end; overnight windows are supported.
- An IANA timezone governs weekdays, time windows, and calendar-day limits.
- Cooldown defaults to 300 seconds. Once-per-day is optional.

Time conditions use event occurrence time. Cooldown/daily limits are consumed
at claim time, including failed claims that reached execution. Limits apply
per automation, not across different automations attached to the same flow.
Updates require the current definition revision. Deleting a definition retains
run snapshots and does not cancel a flow already executing. A definition whose
flow was removed can still be disabled; enabling requires a valid custom flow.

Custom flow persona/destinations are reused. Background modal/dashboard sinks
do not pop a window; email/Slack destinations retain their existing behavior.
Optional completion notifications open the saved automation result. Notification
permission or delivery failure does not turn a successful flow into failure.

`action.inputs` and `action.eventInputMappings` populate initial flow context.
Mapping values are `id`, `type`, `occurredAt`, `payload.idleSeconds` (return
only), `payload.changes`, or `payload.folder` (files only). The reserved `automation` context contains automation ID, run ID, and
source event; user inputs and flow outputs cannot replace it. LLM templates
can read `{{json bag.automation}}` or other initial keys. Custom tool steps
can use `{from:"automation", path:"event.payload.changes"}` for a whole file
batch, or a dot-path such as `event.payload.changes.0.path`. Tool-to-tool and
model-to-tool input wiring remain unsupported. Missing event context fails a
manual run with an explicit missing-input error.

## Storage and execution

`chat.sqlite` includes `automations`, `automation_events`, `automation_state`,
`automation_runs`, and `automation_cursor`. Definitions/run snapshots carry
revisions; each `(automation_id, event_id)` claim is unique. Event insertion,
matching decisions, state updates, and cursor advancement share one transaction.
External calls run outside that transaction.

The native buffer is capped at 1,024 events/two minutes. The daemon polls every
five seconds, backs off to at most 15 seconds during errors, and renews a
30-second subscription lease. Sleep permits a renewal window on wake. Sequence
IDs include a source-session UUID; cursor gaps and source-session changes
establish a fresh baseline. Changing the Toby home resets native subscriptions
and source identity.

Dispatch has two worker slots and a 100-claim pending limit. Idle/wake
automations have one pending/running claim. File automations can queue batches
while busy, with only one running batch per automation. Events expire after two minutes, checked on receipt
and dequeue. Skips record conditions, cooldown, daily limit, busy, capacity,
staleness, or missing-flow errors. Core revalidates the selected flow before
execution and links its normal `flow_runs` history.

Automatic dispatch is at most once per claimed event, not exactly once for
external effects. Restart marks pending/running claims **interrupted**, without
automatic replay: an email may already have been sent. Failures do not retry the
whole flow. Source events/skipped decisions expire after 30 days; executed run
summaries and policy state are retained. Explicit reruns are available through
the selected flow's existing manual run UI.

## API

All proposed paths from the implementation plan are now available to native
clients. Browser Origin/fetch-metadata requests are rejected for these routes.
There is no browser event-ingestion endpoint.

| Method | Daemon path | Result |
| --- | --- | --- |
| GET / POST | `/api/automations` | List / create definition |
| GET / PATCH / DELETE | `/api/automations/:id` | Read / replace using `revision` / delete |
| GET | `/api/automations/catalog` | Triggers, defaults, observation requirements |
| GET | `/api/automations/status` | Source state/message and last poll |
| POST | `/api/automations/:id/test` | Synthetic rule preview; optional validated `event`; no flow, delivery, claim, or policy-state changes |
| GET | `/api/automations/runs?automationId=...` | Recent runs/decisions (default 100) |
| GET | `/api/automations/runs/:id` | Saved event, definition snapshot, result, and flow-run link |

Native bridge paths under `/api/native/automations/`:

- `PUT subscriptions`: `{owner: <UUID>, types: [...], watches: [...]}`; returns session and baseline sequence.
- `GET status`: observation state and idle availability.
- `GET events?sessionId=...&after=...&limit=...`: bounded batch with sequence and explicit gap.
- `POST folder-assessment`: watch configuration with `id`; matching count, visited entries, limited/warning flags. Inspection only.
- `POST completion-notification`: best-effort notification opening a saved run.

The native listener binds to IPv4 loopback. Automation endpoints also reject
browser request headers. Random ports are discovery, not authentication against
other local processes; the existing local-client trust model applies.

## Authoring and UI

**Automations** in the sidebar lists definitions beside inspect details.
Create/edit use the shared native EditorSheet. Review the selected custom flow
and its destinations before saving with Enabled on. The toolbar provides
edit, enable/disable, rule preview, and deletion. Recent runs open result sheets
and the linked flow-step trace. Conditions and initial-input JSON are editable
in the sheet. Missing source status and errors remain visible.

Chat tools `listAutomationCatalog`, `inspectAutomationFolder`, `createAutomation`, and `updateAutomation`
extend the built-in flow-builder skill. Creation/updates do not execute a flow;
tools respect dry run and record applied actions. The skill instructs the model
to enable only when automatic execution and delivery targets were requested.

Implementation: `packages/core/src/automations/`,
`web/handlers/automations.ts`, `ai/automation-authoring-tools.ts`,
`apps/toby-app/.../Native/NativeAutomationEventSource.swift`, and
`Features/Automations/`. See [flows](flows.md), [daemon](daemon.md), and
[the implementation plan](event-automations-plan.md). Broader trigger types remain deferred.

## Folder observation and warnings

Each enabled file definition subscribes a watch keyed by `id:revision`. Old
configuration events cannot execute a revised rule. New watches scan an initial
baseline without replay; downtime and inaccessible-root recovery also establish
fresh baselines. A replaced root/volume identity never produces mass deletion.

FSEvents invalidates snapshots. After the configured quiet interval, serialized
utility-actor scans reconcile regular files using path, size, modification time,
and file identity. Atomic replacement at the same path is changed; rename/move
is deleted at the old path and new at the new path. Removed items carry their
last known size/time, not contents. This is observed filesystem change detection,
not a byte-by-byte content comparison. Transient files that disappear before
settling may produce no event. Quiet time does not guarantee a download finished.

Hidden files, symbolic links, and package descendants are skipped. Extension
filters are case-insensitive; empty means all regular files. Exclusions accept
absolute paths or paths relative to the root and prune subfolders. Each settled
batch is split into at most 500 changes per event. Event payload is
`{watchId, folder, changes:[{kind,path,relativePath,size,modifiedAt}]}`.

Folder inspection runs asynchronously with a cancel action. At 10,000 matching
files, or an incomplete/slow scan, the editor warns and requires **Use folder
anyway**. Acknowledgment is stored in `allowLargeFolder`; the native source also
refuses large unacknowledged watches created through chat/API. Actual observation
scans pause on more than 100,000 visited entries or ten seconds; incomplete scans
never replace a baseline. Narrow the root, recursion, or exclusions when paused.
Inspection counts respect filters but traversal costs can still be high with
few matches. The editor recommends excluding flow output locations.

The editor defaults new file rules to zero cooldown; API/chat authors should set
it explicitly. Cooldown and daily limits intentionally skip otherwise matching
batches. Queued work retains the existing two-minute freshness check and bounded
capacity; skipped batches are visible in run history, without automatic replay.
