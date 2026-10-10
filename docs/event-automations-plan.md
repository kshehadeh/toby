# Event-triggered automations

Status: first release implemented (idle/return and wake). Folder watching is implemented with batched new/changed/deleted events.
See [automations.md](automations.md) for the shipped contract; this document
retains the original implementation plan and future milestones.

## Product model

A flow defines the work. An automation connects a trigger, optional conditions,
and a flow. A schedule is conceptually a time-based automation, but the first
release preserves existing schedules and their execution path.

Example: **Return after 30 minutes idle → weekday morning, at most once per day
→ run my morning briefing flow.**

The first release introduces event automations that run saved custom flows.
Existing scheduled prompts, project/persona bindings, cron behavior, history,
CLI commands, and API contracts continue working. Skills can help author flows
and automations; a skill is not a separate execution target.

## Existing implementation to build on

| Area | Current source | Plan |
| --- | --- | --- |
| Flow execution | `packages/core/src/flows/run-user-flow.ts` | Reuse `runUserFlowById`, extraction, destinations, and node history. |
| Flow inputs and caller label | `packages/core/src/flows/types.ts` | Supply event data through `options.inputs`; use `options.trigger` for attribution. |
| Schedules | `packages/core/src/schedules/` | Preserve prompt and flow targets. Do not create placeholder schedule rows for events. |
| Cron loop | `apps/cli/src/schedules/scheduler.ts` | Keep existing claims and cron semantics in the first release. |
| Daemon lifecycle | `apps/cli/src/commands/daemon.ts` | Start/stop a core automation supervisor alongside existing daemon services. |
| Database | `packages/core/src/session-store.ts` | Add automation definition, event, state, and run tables to `chat.sqlite`. |
| Daemon HTTP API | `packages/core/src/web/routes.ts`, `web/handlers/` | Add automation CRUD, validation, status, and history handlers. |
| Native bridge | `apps/toby-app/Sources/TobyApp/Native/NativeServer.swift` | Add native observation/status/event endpoints. |
| Native UI | `Features/Schedules/`, `Stores/SchedulesStore.swift` | Reuse the established list/detail and run-history patterns. |

Core owns matching, persistence, conditions, claims, and execution. CLI owns
daemon lifecycle wiring and command glue. Toby.app owns macOS API observation
and product UI. TypeScript plugins continue delegating native queries to the
app; do not add Swift plugins or built-in macOS integrations to core.

## First-release scope

### Triggers

| Trigger | User configuration | Meaning |
| --- | --- | --- |
| `macos.userReturned` | Minimum idle duration; default 30 minutes | Input resumes after an observed idle interval meets the threshold. |
| `macos.didWake` | No event-specific configuration | The Mac wakes from system sleep while Toby.app is observing. |

Idle is absence of input, not proof that the user left. Wake does not mean the
user is present or the screen is unlocked. Display wake, login, session
switching, and unlocking must not be substituted for system wake.

Start with public APIs:

- [Core Graphics input-event timing](https://developer.apple.com/documentation/coregraphics/cgeventsource/secondssincelasteventtype(_:eventtype:)) for idle duration.
- [NSWorkspace](https://developer.apple.com/documentation/appkit/nsworkspace) sleep/wake and session activity notifications.

A native feasibility spike must verify permission behavior, physical versus
synthetic input, secure input, multiple user sessions, and sleep handling on
the supported macOS version. Unsupported/unavailable input observations must
report an unavailable state, not a fabricated return event.

### Conditions and execution controls

Conditions are deterministic and combined with AND; no LLM runs to decide
whether an event matches. First-release options:

- Weekdays and an optional local time window, with a stored IANA timezone.
- Once per calendar day, measured at claim time in that timezone.
- Cooldown, default five minutes from the most recent claimed run.
- Enabled/disabled state and flow availability.

Once-per-day and cooldown are consumed on claim, including failed runs, so
repeated signals cannot repeatedly send messages after a partial failure.
Timezone boundaries use a real timezone library; cover DST, overnight windows,
and midnight explicitly. Conditions are evaluated against the occurrence time;
freshness is checked again before starting work.

An automation runs one saved custom flow, with optional constant input values
and an explicit mapping from event fields to initial flow inputs. A selected
flow's persona and destinations remain authoritative. In the first release,
project context follows existing flow capabilities; do not claim that a
schedule's project binding automatically applies to an automation.

### Deferred work

Folder watching, monitor/network changes, arbitrary plugin events, event-driven
prompt targets, arbitrary expressions/OR rules, private focus-history imports,
and a new background helper are later work. Screenshots, selected text, and
additional native query tools are independently useful but are not required
to ship triggers.

## Native event observation and transport

Add a `NativeAutomationEventSource` with injectable clock/input sampling and
a workspace observer adapter. Observe only while enabled automations require
that source. Sample idle time every five seconds; disclose that return timing
is approximate to that interval.

Track one inactivity episode, its highest observed duration, and whether input
resumed. Emit one `userReturned` event per episode; the daemon evaluates each
automation's threshold against the episode duration. Do not emit on every
sample that says the user is active. Startup initializes a baseline without
firing an event. Events contain durations and timestamps, not keystrokes or
mouse coordinates.

On sleep, preserve a known inactivity baseline. On wake, emit the separate wake
event and wait for observed resumed input before emitting a return. Validate
whether OS idle timing includes sleep; represent unknown intervals explicitly
and do not synthesize history across app restarts or missing observations.

Use a daemon-pulled native bridge for the first release:

- Proposed `PUT /api/native/automations/subscriptions`: replace enabled source requirements for the current daemon subscription; return a baseline cursor.
- Proposed `GET /api/native/automations/status`: source availability, observation session, connection state, and last observation time.
- Proposed `GET /api/native/automations/events?sessionId=...&after=...&limit=...`: bounded cursor-based event batches.

The bridge uses an observation-session UUID and monotonic sequence. Event IDs
are `sessionId:sequence`. The native buffer is memory-only, capped at 1,024
events and two minutes of age. Poll every five seconds, with cancellation,
timeouts, and backoff when the app is unavailable. Subscription leases expire
after 30 seconds without renewal; normal shutdown also clears them.

The app reports cursor gaps, session changes, and buffer expiration explicitly.
Reconnect establishes a fresh baseline; no unseen history is invented or
replayed. Pending transport batches within the same session retain IDs for
deduplication. No arbitrary event-ingestion endpoint is exposed to browsers.
Apply the existing local bridge conventions and verify native endpoints really
reject non-loopback connections; a random port alone is not authentication.

Do not auto-relaunch Toby after the user quits it just to collect events. The
daemon marks native triggers **Waiting for Toby.app**, while cron schedules
continue running. Events occurring with the app closed are missed. Closing a
window while the app remains running does not stop observation.

On a Toby home-directory switch, clear subscriptions, buffers, and source
session identity before reconnecting; old-home events must not run new-home
automations.

## Persisted contracts

Proposed types under `packages/core/src/automations/`:

```ts
type AutomationEvent = {
  version: 1;
  id: string;
  source: "macos";
  type: "macos.userReturned" | "macos.didWake";
  occurredAt: string;
  observationSessionId: string;
  sequence: number;
  payload: { idleSeconds?: number };
};

type AutomationDefinition = {
  id: string;
  revision: number;
  name: string;
  enabled: boolean;
  trigger: { type: AutomationEvent["type"]; minimumIdleSeconds?: number };
  conditions: {
    timezone: string;
    weekdays?: number[];
    timeWindow?: { start: string; end: string };
  };
  action: {
    type: "flow";
    flowId: string;
    inputs: Record<string, unknown>;
    eventInputMappings: Record<string, string>;
  };
  policy: { cooldownSeconds: number; oncePerDay: boolean };
  notifyOnCompletion: boolean;
};
```

Use discriminated runtime schemas per event/trigger, rather than accepting an
idle threshold on a wake trigger. Version definitions and enforce revision
checks on edits. Reserve `automation` in the initial flow bag for immutable
event/run context; reject user input mappings and flow output mappings that
overwrite it, validating the selected flow again before execution. Event fields
are data, never instructions or executable expressions.

New tables:

- `automations`: versioned definitions and timestamps.
- `automation_events`: unique source event IDs, occurrence/receipt times, bounded payloads.
- `automation_state`: last claim, local day consumed, and current claim/run reference.
- `automation_runs`: automation revision snapshot, event link, status, skip reason, flow-run link, timestamps, and errors.

Use unique `(automation_id, event_id)` claims. Keep event insertion, decision
records, claim/policy-state updates, and committed transport cursor in one
SQLite transaction. Advance the cursor only after persistence succeeds.
No LLM or plugin calls occur inside that transaction.

Deleting or editing an automation must preserve historic snapshots. Missing
flows suspend future execution with an actionable reason. In-flight runs keep
their claimed definition snapshot. Disabling prevents new claims; it does not
silently terminate an already running flow.

Default history retention: 30 days for source events and automation decisions;
retain run summaries according to existing run-history conventions. Pruning
must not remove the policy state or uniqueness information needed to prevent
duplicate claims within the supported transport/freshness window.

## Matching, dispatch, and failure behavior

The automation supervisor persists and matches events independently of the
execution worker, so a long flow cannot block event ingestion. Proposed limits:

- Two concurrent automation runs globally.
- One active run per automation; further matching events are skipped as busy.
- Maximum 100 pending claims; excess matches are skipped as capacity-limited.
- Events older than two minutes are skipped; repeat the check when dequeuing.
- Before execution, recheck enabled state and required flow availability.

Return and wake are distinct events. Users can attach separate automations to
each; once-per-day and cooldown apply per automation, not across unrelated
definitions. If both should start the same task under one limit, a future
multi-trigger definition can support that without silently merging events now.

Call `runUserFlowById` with mapped inputs and
`trigger: "automation:<automationId>:<eventId>"`. Persist its `flowRunId` back
to the automation run and reuse existing node and destination records.

Delivery attempts use idempotent event ingestion and at-most-once automatic
dispatch, not an exactly-once guarantee for external effects. After a daemon
restart, pending/running claims are marked interrupted and are not replayed
automatically: a crash may have happened after an email was sent. Surface that
uncertainty and allow an explicit manual rerun. A flow or delivery failure is
recorded without an automatic retry of the whole flow.

Background execution does not wait for interactive questions. Existing
email/Slack flow destinations work. Existing modal/dashboard destinations do
not open windows from the daemon. Add an optional completion notification that
opens the saved run result, so a morning briefing is useful without forcing UI
focus. Notification permission failures must not fail a completed flow.

## API and native product experience

Proposed daemon endpoints:

- `GET/POST /api/automations`; `GET/PATCH/DELETE /api/automations/:id`.
- `GET /api/automations/catalog`: supported triggers, schemas, and availability.
- `POST /api/automations/:id/test`: evaluate a synthetic event and preview input mappings; no execution, delivery, or claim-state changes.
- `GET /api/automations/runs`; `GET /api/automations/runs/:id`.
- `GET /api/automations/status`: source health and last successful poll.

The native UI adds an **Automations** destination with the existing workspace
list/detail pattern. First-release editing includes name, trigger, idle
threshold where applicable, conditions, selected flow, cooldown/once-per-day,
completion notification, and enabled state. Require an explicit save and
enable action after users review the selected flow and its delivery targets.

Detail/history explains **why** a flow ran or was skipped: condition mismatch,
cooldown, daily limit, busy, stale event, source unavailable, failed, or
interrupted. Show `Waiting for Toby.app` and missing-permission states clearly.
Offer a rule-preview test without running the flow; actual manual execution
uses the existing flow run UI.

Keep Schedules available as its current surface in the first release. A later
Automations view may include both schedule and event rows, with Schedules as a
time-based filter, while preserving schedule IDs and deep links. Never let both
the old cron loop and a new time-trigger engine dispatch the same schedule.

Before implementing native UI, apply `DESIGN.md`, `toby-design`, and
`toby-native-window`; reuse `AppTheme`, native controls, and existing workspace
primitives. Include loading, empty, selection, disabled, unavailable, failure,
keyboard, accessibility, and light/dark states.

## Implementation milestones

1. **Native feasibility and semantics**: build the observation adapter, prove idle transitions and real wake behavior, document permissions and sampling limits. Exit: reproducible events and no startup/sleep false returns.
2. **Core engine and durable claims**: schemas, tables, matcher, policy state, worker, run links, and restart behavior with fake event sources. Exit: duplicate/race/crash tests pass without touching native APIs.
3. **Native transport and daemon wiring**: subscription leases, cursors, source status, home-switch reset, lifecycle cancellation, and real flow execution. Exit: idle return starts one test flow and reconnects do not replay it.
4. **API and app UI**: CRUD, rule preview, editor, availability/history, completion notifications. Exit: a user can create, enable, inspect, and disable an automation end to end.
5. **Authoring and release documentation**: expose automation catalog/create/update tools and extend the existing flow-builder skill to configure triggers after the flow is saved. Update technical and help docs; capture screenshots.
6. **Folder watching next**: add the event-source interface implementation for selected folders using FSEvents, path access, write-stability checks, extension filters, and output-folder exclusions. No database or flow-runner redesign should be needed.

Later, extract shared dispatch policy for cron/event targets and present
schedules through the wider Automations model. Only migrate stored schedules
if the benefit warrants it; prompt schedules must retain their behavior.

## Verification and acceptance

- Native tests with injected input/clock: active → idle → return, threshold boundaries, repeated samples, startup while idle, workspace sleep/wake, unavailable readings, source stop/restart, and home switches.
- Core Bun tests: schema validation, mapped flow inputs, duplicate batches, concurrent claims, rollback before cursor advancement, revision changes, disable/delete behavior, cooldown/daily limits, timezone/DST, capacity, stale pending work, and crash recovery.
- Integration tests: native session change/cursor gap, daemon offline reconnect, app-closed status without relaunch, permission failures, and delivery failure without automatic resend.
- Native UI tests: form validation, source states, rule preview with no side effects, enable/disable, history navigation, and completion-result opening.
- Manual checks: real system sleep/wake; return after configured inactivity; closing app versus closing its window; two automations with different thresholds; duplicate poll delivery; restart during a deliberately slow flow.
- Run `bun run lint`, `bun run typecheck`, `bun run test`, and `bun run test:swift` after implementation, plus a Dev app build and the relevant help-site build.

Done means a user can enable a weekday morning return automation, receive one
briefing per day, inspect the triggering event and flow output, and understand
missed events or interrupted runs without duplicate automatic deliveries.

## Documentation at implementation time

Update `docs/flows.md`, `docs/daemon.md`, `docs/server-api.md`,
`docs/native-helpers.md`, `docs/macos-integration.md`, and the docs index.
Add user-facing automation coverage under `apps/help-site/docs/` and cross-link
the existing flows/schedules/macOS pages. Describe app-running requirements,
idle versus presence, test versus run, permissions, missed-event behavior,
history, and restart limitations. This proposal does not change shipped docs
to claim the feature exists.
