# The Feed — dashboard block plan

A home-dashboard block that looks across every connection (calendar, email,
tasks, news, later Slack/Jira) and lists the most relevant, timely items in
priority order — each with a one-line explanation and calls to action.

## Decisions

| Question | Decision |
| --- | --- |
| Relationship to existing cards | Ships **alongside** Unread mail / Tasks / Upcoming; designed to **replace** them later. Keep the Feed self-sufficient (no dependency on those cards' flows or markdown). |
| "Add to my todo list" target | **Built-in Toby todos** (`packages/core/src/todos/service.ts` → `createTodo`). |
| "Draft a reply" UX | **Opens a chat** seeded with the message context; the agent uses the email plugin's `createDraft`. |
| Refresh | **Background, periodic** (scheduled flow trigger), plus on-demand refresh from the card. |
| Model | **Its own provider + model** (`dashboard.feed.provider` / `dashboard.feed.model`), independent of the dashboard persona. Picker **only offers models that support structured output**; enforced again at run time. See [Model selection](#model-selection). |

## What already exists

- **Collection** — standard tools (`email.unreadSummary`, `tasks.openSummary`,
  `calendar.upcomingSummary`) called without an LLM by `getDashboardCategory()`
  in `packages/core/src/dashboard/index.ts`, normalized to `DashboardItem`.
- **Card bodies** — built-in flows (tool → LLM) in `flows/builtins.ts` producing
  markdown `DashboardBlockContent`. No per-item identity or actions.
- **Scheduling** — flow triggers support `schedule` (cron, via `croner`) and are
  run by `flows/triggers/supervisor.ts`.
- **Notifications** — `NativeNotificationCoordinator.swift` (native API server).
- **Chat seeding** — `store.startChatWithPrompt(…)` (`RootView.swift`).
- **Memory** — `memory/memory-service.ts` (`listUsableForPrompt`) for personalization.
- **Gaps** — news has a summary mapper but no `standardTool` tag; Slack/Jira
  have no summary tools.

## Architecture

```
schedule trigger (every 15 min, configurable) ─┐
card refresh / ?fresh=1 ───────────────────────┤
                                               ▼
collect (no AI) → pre-filter (heuristics) → rank + explain (1 LLM call) → attach actions → persist feed
email/tasks/cal   dedupe, drop past events,   ordered ids, tier, reason,     from typed catalog,   feed.json
+news (+slack,    bulk-mail filter, boosts,   action ids chosen from an      filtered by provider  + notify new
 jira later)      cap ~40 candidates          allowed list per kind          capabilities          "now" items
```

Module: `packages/core/src/feed/`

### 1. Item model (`feed/types.ts`)

```ts
type FeedTier = "now" | "today" | "fyi";

interface FeedItem {
  readonly id: string;                 // `${providerName}:${sourceItemId}` — stable
  readonly source: {
    readonly category: string;         // email | calendar | tasks | news | …
    readonly providerName: string;
    readonly itemId: string;           // round-trips to the plugin
    readonly url?: string;
  };
  readonly tier: FeedTier;
  readonly title: string;
  readonly subtitle?: string;          // sender / calendar / list
  readonly reason: string;             // the "why this matters" sentence
  readonly timestamp?: string;
  readonly actions: readonly FeedAction[]; // primary first
}

interface FeedAction {
  readonly id: FeedActionId;           // "email.draftReply", "todo.add", …
  readonly label: string;              // "Draft a reply"
  readonly kind: "chat" | "tool" | "open" | "local";
}

interface FeedContent {
  readonly items: readonly FeedItem[];
  readonly generatedAt: string;
  readonly personaName: string;
  readonly sources: readonly DashboardBlockContentSource[];
  readonly failedSources: readonly string[]; // providers that timed out/errored
}
```

### 2. Collection (`feed/collect.ts`)

- Fan out over `getDashboardCategory` for email, tasks, calendar; reuse its
  per-provider timeout so one broken provider only drops out.
- Phase 4 adds standard tools: `news.headlinesSummary` (tag existing news tool),
  `chat.mentionsSummary` (Slack), `work_tracker.assignedSummary` (Jira).
- Also include **Toby todos** due today/overdue directly from `listTodos`.

### 3. Pre-filter (`feed/prefilter.ts`, pure + unit tested)

- Drop ended events, done tasks, dismissed/snoozed/acted-on ids (feed state).
- Down-rank bulk mail (newsletters, no-reply senders).
- Boost: events in the next few hours, unanswered invites, overdue/due-today
  tasks, mail addressed directly to the user or from a known contact.
- Cap ~40 candidates; produce a deterministic signature for caching.

### 4. Rank + explain — built-in flow `dashboard.feed`

- Collector output seeded into the flow bag (same pattern as
  `runDashboardCategoryFlow` in `dashboard/summarizer.ts`).
- LLM node with **structured output** returning
  `{ items: [{ candidateId, tier, reason, actionIds[] }] }`.
  `llm-prompter` already tries `Output.object` and falls back to free-form
  coercion; the Feed node sets a new `structuredOutput: "required"` option that
  **disables the free-form fallback** (a schema miss is a run error, not a
  best-effort parse).
- Model comes from the Feed's own model setting (below), not the persona's
  `ai` block. The persona (dashboard persona) still supplies tone/instructions.
- Prompt includes: current date/time, user memory (`listUsableForPrompt`),
  recent "not relevant" feedback, and the **allowed action ids per candidate kind**.
- Server-side validation: unknown `candidateId` / disallowed `actionId` dropped;
  `open` + `dismiss` always appended deterministically.
- Persona: dashboard persona (`config.dashboard.persona`) for instructions only;
  GatewayFunds → 402.

### Model selection

**Config** (`DashboardConfig` in `config/index.ts`, mirrors `LibraryConfig`):

```ts
interface DashboardConfig {
  readonly persona?: string;
  readonly feed?: {
    readonly provider?: string;   // AI provider id
    readonly model?: string;      // must support structured output
    readonly refreshCron?: string;
    readonly backgroundRefresh?: boolean;
    readonly notifications?: boolean;
  };
}
```

**Capability metadata** — add `structuredOutput?: boolean` to `AIModelListItem`
(`ai/model-list/types.ts`), set by each adapter from what its catalog exposes
(checked against live catalogs):

| Provider | Signal | Coverage seen |
| --- | --- | --- |
| OpenRouter | `supported_parameters` includes `"structured_outputs"` | 393 / 468 models |
| Vercel AI Gateway | `tags` includes `"structured-output"` | 283 / 509 models |
| Chutes | `supported_features` includes `"structured_outputs"` | per model |
| OpenAI | no catalog field → curated id allow-list (`gpt-4o*`, `gpt-4.1*`, `gpt-5*`, `o3*`, `o4*`) | maintained in code |
| Ollama | no reliable signal → **excluded** in v1 | — |

Unknown = **not supported**: custom-added model ids and models a catalog
doesn't tag are excluded. The capability helper lives in one place
(`ai/model-capabilities.ts` → `modelSupportsStructuredOutput(providerId, item)`)
so pickers and runtime agree.

**Picker** (Configure → Home → The Feed, built like the Library model rows in
`configure/tree.ts`):
- Provider list only shows configured providers with ≥ 1 eligible model.
- Model list only shows eligible models; no "add custom model" sentinel.
- Empty state: "No connected provider offers a model with structured output."

**Runtime enforcement** (config can be hand-edited, catalogs change):
- Before each run, resolve the model and re-check eligibility against the
  cached model list. Ineligible/unset → skip the run and return feed content
  with a `setupRequired` reason; the card shows "Choose a Feed model" linking
  to settings. Background runs log and do not notify.
- **Default when unset:** the dashboard persona's model if eligible, else the
  provider's auxiliary model (`resolveAuxiliaryModelId`) if eligible, else
  `setupRequired`.
- Model factory: Chutes is currently created without
  `supportsStructuredOutputs`; enable it (at least for Feed calls) so the
  schema is actually sent as `json_schema` rather than plain JSON mode.
  OpenRouter already sets it.

### 5. Action catalog (`feed/actions.ts`, static, typed)

| Kind | Action id | Label | Execution |
| --- | --- | --- | --- |
| email | `email.draftReply` | Draft a reply | `chat` — seeded prompt with message id/sender/subject; agent drafts via `createDraft`, never sends |
| email | `todo.add` | Add to my todo list | `tool` — `createTodo` with title, link back to message, due inferred if obvious |
| email | `email.archive` / `email.markRead` | Archive / Mark read | `tool` — email plugin tools |
| calendar | `calendar.prep` | Prep for this meeting | `chat` — event + attendees + related mail |
| calendar | `calendar.join` | Join | `open` — meeting URL when present |
| tasks / todos | `task.complete` | Complete | `tool` — provider tool or `transitionTodo` |
| tasks / todos | `task.snooze` | Snooze | `tool` — reschedule |
| news | `news.summarize` | Summarize | `chat` |
| news | `todo.add` | Save for later | `tool` — `createTodo` |
| any | `open` | Open | `open` — item URL |
| any | `dismiss` / `snooze` / `notRelevant` | Dismiss / Snooze / Not relevant | `local` — feed state |

Rule: nothing is sent or deleted automatically; destructive provider actions
(archive, complete) are one tap but reversible or provider-undoable.

### 6. State + persistence (`feed/state.ts`)

- `feed.json` (next to dashboard summaries): last `FeedContent`.
- `feed-state.json`: `{ dismissed, snoozedUntil, actedOn, notRelevant[] }` with
  pruning (e.g. 30 days). `notRelevant` samples go back into the ranking prompt.
- `notifiedIds` so a "now" item notifies at most once.

### 7. Background refresh

- `dashboard.feed` built-in flow carries a `schedule` trigger (default every
  15 min during waking hours, e.g. `*/15 7-22 * * *`) plus `dashboardRefreshTrigger()`.
- Skip the LLM call when the pre-filter signature is unchanged since last run.
- After each run, newly-appeared **"now"** items → native notification via the
  app's native API (`NativeNotificationCoordinator`); clicking opens the Feed.
- Settings: enable/disable background refresh, interval, notifications on/off
  (config `dashboard.feed.*`, surfaced in Configure).

### 8. Daemon API (`web/handlers/dashboard.ts` + `web/routes.ts`)

- `GET  /api/dashboard/feed` — persisted feed; `?fresh=1` forces a run.
- `POST /api/dashboard/feed/actions` `{ itemId, actionId }` — runs `tool` and
  `local` actions; returns updated item/feed. `chat` actions return the seeded
  prompt for the client to open.

### 9. Swift card (`apps/toby-app/Sources/TobyApp/Features/Dashboard/Feed/`)

- `DashboardBlockID.feed` + built-in descriptor, default first and full width.
- `FeedDashboardBlock` (own controller, not `CategoryDashboardBlock`, which is
  markdown-only) and `FeedCardView` / `FeedItemRow`.
- Row: source icon · title · reason · relative time · primary CTA button ·
  overflow menu (other actions, snooze, dismiss, not relevant). Grouped by tier.
- `chat` actions → `navigateToRoute(.chat)` + `startChatWithPrompt(prompt)`.
- Optimistic removal on dismiss/act; refresh when the daemon reports a new run.
- ViewInspector tests per CLAUDE.md (direct tree navigation).

## Phases

1. **Core** — types, collector (email/tasks/calendar/todos), pre-filter,
   `dashboard.feed` ranking flow with required structured output, Feed model
   config + `structuredOutput` capability in model-list adapters + runtime
   eligibility check, Configure picker rows, persistence,
   `GET /api/dashboard/feed`. Vitest: pre-filter, validation of model output,
   caching/signature skip, adapter capability parsing (fixtures per catalog),
   eligibility + default resolution.
2. **Card (read-only + chat)** — Swift Feed block with `open` and `chat`
   actions (Draft a reply, Prep for meeting, Summarize).
3. **Actions + background** — `POST …/actions`, `todo.add` into Toby todos,
   archive/mark read/complete/snooze, feed state, schedule trigger,
   notifications for new "now" items, settings.
4. **Sources + personalization** — news/Slack/Jira standard tools,
   memory-driven relevance, "not relevant" feedback loop.
5. **Replacement** — once the Feed covers their content, hide the legacy
   Mail/Tasks/Upcoming cards by default and migrate layouts.

## Phase 1 status

Done (branch `feat/the-feed`):
- `packages/core/src/feed/` — types, action catalog, collector (email/calendar/
  tasks aggregator + Toby todos), pre-filter, ranking flow, Feed service with
  signature cache, 15-min re-rank window, stale-while-revalidate, persistence
  (`~/.toby/dashboard-feed.json`).
- `structuredOutput: "required"` on `llm_prompter` (no free-form fallback).
- `structuredOutput` flag in all model-list adapters (+ curated OpenAI and
  Vercel fallback enrichment); Chutes now sends `json_schema`.
- `dashboard.feed.{provider,model}` config, Settings → Home rows (eligible
  providers/models only), runtime eligibility + defaults.
- `GET /api/dashboard/feed[?fresh=1]`.
- Tests: `apps/cli/tests/feed*.test.ts`.

Findings / still open:
- The email standard tool only exposes subject, sender, date, and a flag — no
  snippet, to/cc, or list headers. "Needs a reply" is inferred from subject +
  sender + bulk heuristics until `email.unreadSummary` items carry `detail`
  (snippet) and recipient metadata (phase 4 candidate).
- How a background run reaches `NativeNotificationCoordinator` (phase 3).
- Native Settings rendering of the new Home rows is unverified until the app
  is run (rows use the generic `select`/`hint` kinds).

## Phase 2 status

Done:
- `FeedModels.swift`, `TobyClient.fetchDashboardFeed`, `FeedStore` (owned by
  `DashboardStore`; included in global refresh and home-switch reset).
- `Features/Dashboard/Feed/FeedCardView.swift` — full-width section above the
  card grid: tiers, reason, primary + secondary CTA buttons, overflow menu,
  setup / no-sources / empty / error states, Feed settings + Hide in the menu.
- Chat actions → `startChatWithPrompt`; open actions → `NSWorkspace.open`.
  Tool actions (archive, add todo, complete) are filtered out until phase 3.
- Dismiss hides an item for the session only (daemon persistence is phase 3).
- Settings → Home → "Show The Feed" (`toby.appearance.showFeed`, default on).
- Tests: `apps/toby-app/Tests/TobyAppTests/FeedTests.swift`.

Notes:
- ViewInspector crashes ("Can't unsafeBitCast between types of different
  sizes") traversing `CardHeader` on the current toolchain — pre-existing, the
  `DashboardBlockCard` title test crashes on a clean tree too, and the full
  Swift suite aborts. Feed view tests target `FeedCardBody` to avoid it.
- The Feed is not part of the reorderable card grid (the waterfall layout has
  no full-width span); hide/show is the Settings toggle or the card menu.

## Phase 3 status

Done:
- **Item-action contract** (`dashboard/types.ts`): standard tools
  `email.archiveItem`, `email.markItemRead`, `tasks.completeItem` take
  `{ id }` (the plugin's own `DashboardItem.id`) and return `{ ok, message }`.
  The plugin adapter exposes them as `dashboard.supportsItemAction` /
  `runItemAction` and hides them from chat tool sets (chat keeps the richer
  tools). Implemented by email (`archiveDashboardItem`,
  `markDashboardItemRead`), Todoist and Apple Reminders
  (`completeDashboardItem`).
- **Capability gating**: candidates carry `providerActions`; the ranking prompt
  and `resolveActions` only offer archive / mark read / complete when the
  source plugin implements them. Toby todos complete via `transitionTodo`.
- **Feed state** (`feed/state.ts`, `~/.toby/dashboard-feed-state.json`):
  dismissed / snoozed (until 8:00 next day) / done, plus `notified`; pruned
  after 30 days. Hidden items are filtered from responses and excluded from
  ranking (the changed signature triggers a background re-rank to refill).
- **`POST /api/dashboard/feed/actions`** `{ itemId, actionId }`
  (`feed/execute.ts`): dismiss, snooze, `todo.add` (`createTodo`, source
  `feed`, calendar items due on the event day), provider actions, todo
  complete. Validates the action is on the item; 404 unknown item, 400 bad
  action, 409 todo conflicts, 502 provider failures (item stays visible).
- **Background refresh** (`feed/scheduler.ts`, started by the daemon when the
  web API is on): every `intervalMinutes` (default 15) between 07:00–22:00,
  60 s after start; re-collects sources and re-ranks inline only when the
  candidate set changed or the ranking is >15 min old.
- **Notifications**: new "Now" items → `POST /api/native/feed/notification`
  (one item directly, several as a summary); marked notified only once the app
  accepts it. Clicking opens Home and refreshes The Feed.
- **Settings → Home**: background refresh on/off, interval (5/15/30/60 min),
  notifications on/off (`dashboard.feed.backgroundRefresh`,
  `intervalMinutes`, `notifications`; only non-defaults are persisted).
- **App**: tool actions shown as CTAs; snooze + dismiss in the overflow menu;
  optimistic hide with restore + error toast on failure; success toast; soft
  Feed poll every 5 min while Home is open.
- Tests: `apps/cli/tests/feed-actions.test.ts`, `feed-service.test.ts`
  (state filtering), Swift `FeedTests.swift`.

Notes / open:
- Active hours (07–22) are fixed; not yet configurable.
- No undo for dismiss/snooze/done yet (state lives in the JSON file).
- `notified` is per item id, so a recurring event instance with a new id
  notifies again.
