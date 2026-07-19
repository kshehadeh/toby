# Home dashboard data population

How Toby.app’s home-screen cards (unread mail, tasks, upcoming calendar) get
their data. The **chat** pipeline is not involved.

Each card uses **two independent paths**:

1. **Deterministic data** — badge count, sources, item rows (standard tools +
   aggregator, no LLM)
2. **AI prose** — short markdown under the card, produced by a **named flow
   pipeline** (Tool Executor → LLM Prompter)

| Topic | Doc |
| --- | --- |
| Flow / pipeline design | [`flows.md`](flows.md) |
| Standard tool contract & plugin checklist | [`dashboard-standard-tools-plan.md`](dashboard-standard-tools-plan.md) |

## Overview

Each integration-backed card is a **category** (`email`, `tasks`, `calendar`).
A category may be fed by multiple plugins (for example Todoist and Apple
Reminders both contribute to `tasks`). Plugins declare
`providerCategories` and tag one tool with a reserved `standardTool` ID; core
synthesizes a `dashboard.getSummary` hook that executes that tool without an
LLM.

| Category | Standard tool ID | Example plugins | AI flow |
| --- | --- | --- | --- |
| `email` | `email.unreadSummary` | `email` (IMAP/SMTP) | `dashboard.email.summary` |
| `tasks` | `tasks.openSummary` | `todoist`, `applereminders` | `dashboard.tasks.summary` |
| `calendar` | `calendar.upcomingSummary` | `applecalendar` | `dashboard.calendar.summary` |

Despite names like `email.unreadSummary`, standard tools return a **list/count
shape** (metadata items), not LLM prose. The AI blurb is a separate step.

## End-to-end flow

### Deterministic path (badge + list)

```
DashboardView (.task / refresh button)
        │
        ▼
DashboardStore  (per-category parallel load)
        │
        ▼
TobyClient  GET /api/dashboard/:category
        │
        ▼
getDashboardCategory  (60s in-memory cache)
        │
        ▼
Aggregator: connected modules with providerCategories + dashboard hook
        │
        ▼
module.dashboard.getSummary({ limit })
        │
        ▼
Plugin adapter: standardTool tag → tools execute
        │
        ▼
DashboardSummaryResult → Zod validate → merge → JSON
        │
        ▼
DashboardStore → card UI (badge, sources, items)
```

### AI path (markdown under the card)

```
DashboardStore  GET /api/dashboard/:category/summary
        │
        ▼
getDashboardCategorySummary(category)
        │
        ├─ getDashboardCategory (cache key / empty check)
        ├─ AI cache (5 min memory + ~/.toby/dashboard-summaries.json)
        │
        ▼ (on miss)
runFlow("dashboard.<category>.summary")
        │
        ├─ Tool Executor  → standard tool (list metadata, one provider)
        └─ LLM Prompter   → { markdown: string }  (dashboard persona)
        │
        ▼
Map markdown → DashboardCategoryAiSummary.text
        │
        ▼
DashboardStore → card AI blurb
```

Details of node wiring and runtime: [`flows.md`](flows.md).

## When the UI refreshes

| Trigger | Code path | What loads |
| --- | --- | --- |
| Home dashboard appears | `DashboardView.task` | `store.load()` then `store.loadSummariesIfStale()` |
| Global refresh | `RootView.refreshDashboardData()` | `load()` + shared app stores + `reloadSummaries()` |
| Card refresh button | e.g. `store.refreshEmail()` | That category’s **data**, then its **AI summary** |

### Swift store behavior

`DashboardStore` (`apps/toby-app/Sources/TobyApp/Stores/DashboardStore.swift`):

- Loads **email / tasks / calendar in parallel** so a slow provider (e.g. IMAP)
  never blocks the other cards.
- Tracks per-category loading flags and errors.
- Uses **per-category** HTTP (`GET /api/dashboard/:category`), not only the
  bulk `GET /api/dashboard`.
- If the API returns JSON `null` (no connected providers for that category),
  the store keeps the previous non-nil value (`if let latest = …`).
- AI summaries are skipped when `category.count == 0`.
- Client treats AI summaries as stale after **5 minutes**
  (`summaryStaleInterval`); after load it may re-fetch once if the server
  returned a disk-persisted (old) summary.

Card visibility (show/hide email, tasks, calendar) is **app-local** via
`AppearancePreferences` / Settings → Dashboard — not controlled by the
daemon. See [`architecture.md`](architecture.md) for UserDefaults keys.

## HTTP API

Routes are registered in `packages/core/src/web/routes.ts` and handled in
`packages/core/src/web/handlers/dashboard.ts`. High-level table also lives in
[`server-api.md`](server-api.md).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/dashboard` | All categories (`email`, `tasks`, `calendar`) in parallel |
| `GET` | `/api/dashboard/:category` | Deterministic category data, or `null` |
| `GET` | `/api/dashboard/:category/summary` | AI summary via flow pipeline, or `null` |

Unknown categories return `404` with
`{ "error": "Unknown dashboard category: …" }`.

Toby.app client: `TobyClient.fetchDashboardCategory` /
`fetchDashboardCategorySummary` in
`apps/toby-app/Sources/TobyApp/Utilities/TobyClient.swift`.

## Aggregator (core)

Implementation: `packages/core/src/dashboard/index.ts`.

### Per-category fetch (`getDashboardCategory`)

1. **In-memory cache**, keyed by category name, **TTL 60 seconds**. Cache hits
   skip all plugins.
2. **Module filter**: integrations whose `providerCategories` includes the
   category and that expose `module.dashboard`.
3. **Default provider (calendar only)**: if `defaultProviders.calendar` is set
   in config and that module has a dashboard hook, only that provider is
   queried; otherwise all calendar providers with the hook are used.
4. For each candidate: `isConnected()`; skip if false.
5. Call `dashboard.getSummary({ limit })` with **25s** timeout
   (`Promise.race`). Timeout, throw, or missing hook → that provider is
   excluded (daemon warning on throw).
6. Merge successful sources into `DashboardCategorySummary` (see plan doc for
   field semantics).

Constants of note:

| Constant | Value | Role |
| --- | --- | --- |
| Category cache TTL | 60s | On-demand refresh may still serve cached data |
| Per-provider timeout | 25s | One hung plugin does not block the category forever |
| Default item limit | 20 | Passed into each provider’s standard tool |
| Max items after merge | 100 | Cap on `category.items` |

Sort after merge: **email** and **tasks** newest-first (timestamp descending);
**calendar** soonest-first (ascending). Each merged item gets
`providerName` set by the aggregator (plugins must not set it).

`clearDashboardCache()` clears the in-memory map (tests / connection-state
changes).

## How plugins plug in

Installable plugins do **not** implement `dashboard` themselves. Discovery
loads the plugin; `createPluginIntegrationModule` in
`packages/core/src/integrations/plugins/adapter.ts` calls
`buildPluginDashboardHook` when the manifest has `providerCategories` that map
to known standard tools.

### Synthesis (`buildPluginDashboardHook`)

1. Map each category → expected `StandardToolId` via
   `STANDARD_TOOL_FOR_CATEGORY` (`packages/core/src/dashboard/types.ts`).
2. On `getSummary({ limit })`:
   - Resolve tool **name** by listing tools and matching
     `tool.standardTool === <id>` (tool definitions are cached).
   - If no matching tool → throw (aggregator treats as provider failure).
   - Run `pluginToolsExecuteAsync` with `{ tool, input: { limit? }, config, … }`.
   - On exec failure or Zod validation failure → return an **empty** summary
     `{ count: 0, items: [], generatedAt: now }` (not `null`).
   - On success → validated `DashboardSummaryResult`.

Tool **names** are arbitrary; only the `standardTool` tag matters. Doctor /
plugin validation can warn when a category is declared without the matching
tag (`checkStandardToolCompliance`).

The flow **Tool Executor** resolves the same `standardTool` IDs independently
(prefer default/connected provider). See
[`flows.md`](flows.md#tool-executor).

### Reserved result shape

```ts
interface DashboardSummaryResult {
  count: number;
  groups?: { id: string; label: string; count: number }[];
  items: DashboardItem[];
  launchUrl?: string; // optional; overrides module static launchUrl
  generatedAt: string; // ISO 8601
}
```

Full item fields, urgency rules, and merge details:
[`dashboard-standard-tools-plan.md`](dashboard-standard-tools-plan.md).

## Walkthrough: email card

Concrete path for the Unread Mail block (tasks/calendar are analogous).

### 1. Plugin declaration

`apps/plugin-email/manifest.json`:

- `providerCategories: ["email"]`
- No special dashboard field in the manifest

### 2. Standard tool (deterministic list)

`apps/plugin-email/src/tools.ts` defines `getUnreadSummary` with
`standardTool: "email.unreadSummary"`. Input is optional `{ limit }`.

On execute (`fetchUnreadInbox`):

1. Live IMAP (not the SQLite chat cache)
2. Unseen count + newest unread envelopes
3. Items: subject, from, date, flagged → urgency
4. Optional webmail `launchUrl`

> Note: the tool’s human description may still say “local cache”; the
> implementation is **live IMAP** so the badge matches server unread state.

### 3. Deterministic aggregation and UI

- Aggregator includes the `email` module if connected and the hook succeeds.
- Swift `UnreadMailCard` binds to `store.email` (badge, sources, items).

### 4. AI blurb via flow

On `GET /api/dashboard/email/summary` (after cache miss):

1. Flow `dashboard.email.summary` runs.
2. **Tool Executor** re-fetches `email.unreadSummary` (limit 50) into bag
   key `unread`.
3. **LLM Prompter** uses email category prompt + dashboard persona; schema
   `{ markdown: string }` → bag key `summary`.
4. Summarizer maps markdown → `DashboardCategoryAiSummary` and persists caches.

Card refresh: `refreshEmail()` → `loadEmail()` then `loadEmailSummary()`.

## AI summary path (flows)

Implementation: `packages/core/src/dashboard/summarizer.ts`  
Flow runtime: `packages/core/src/flows/` — see [`flows.md`](flows.md)

### Category → flow

| Category | Flow id | Tool bag key | Seed |
| --- | --- | --- | --- |
| `email` | `dashboard.email.summary` | `unread` | `flows/builtins.ts` |
| `tasks` | `dashboard.tasks.summary` | `openTasks` | `flows/builtins.ts` |
| `calendar` | `dashboard.calendar.summary` | `upcoming` | `flows/builtins.ts` |

Definitions are stored in the `flows` SQLite table and **seeded on first
lookup** from `builtins.ts` when missing. See [`flows.md`](flows.md).

Shared shape for every category flow:

```
Tool Executor (standardTool, limit: 50)
        ↓ bag.<key>
LLM Prompter → { markdown: string }
        ↓ bag.summary
```

Category prompt text is inlined into built-in system prompt templates (from
`CATEGORY_PROMPTS` in `packages/core/src/dashboard/prompts.ts`). Item formatting
uses `{{dashboardItems bag.<key>}}` templates at run time.

### Caching and persona

1. Load deterministic category data via `getDashboardCategory(category, {
   limit: 50 })` (shares the 60s category cache) for empty-state and **cache
   signature**.
2. If no data or `count === 0` → `null` (no flow run).
3. Cache key: `category` + dashboard persona + **data signature** (count,
   `generatedAt`, item ids/titles/timestamps).
4. **In-memory AI cache TTL: 5 minutes**.
5. Disk fallback: `~/.toby/dashboard-summaries.json` — after daemon restart the
   UI can show the last summary immediately while a background refresh runs.
6. Persona: `config.dashboard.persona`, else default (`resolveDashboardPersona`).
7. On generate: `runFlow(…)` then strip chain-of-thought leakage with
   `extractDashboardSummaryText` on the structured `markdown` field.

Config UI: configure tree key `dashboard.persona` (Settings / configure
persistence). The field description advises preferring a **non-reasoning**
model for dashboard summaries.

### Multi-provider note

- **Card list/badge** (`GET /api/dashboard/:category`): may merge **all**
  connected providers in the category (calendar may prefer the default
  provider only).
- **Flow Tool Executor**: resolves **one** connected provider for the
  standard tool (default provider when set, else first connected match).

Acceptable for v1; multi-provider AI context would require a future node or
flow input that reuses the aggregator result.

### Response shape

```ts
interface DashboardCategoryAiSummary {
  category: string;
  text: string;           // markdown from flow summary.markdown
  generatedAt: string;
  personaName: string;
  count: number;
  launchUrls: string[];
}
```

## Failure and empty-state semantics

| Situation | Aggregator / API behavior | Typical UI effect |
| --- | --- | --- |
| No module for category | Category `null` | Empty / connect prompt (store may keep last value) |
| Module not connected | Skipped | Same as no sources if all skipped |
| Provider timeout (25s) | Excluded from `sources` | Other providers still show |
| Provider throw | Logged + excluded | Same |
| Tool exec / Zod failure (hook) | Empty summary `{ count: 0, items: [] }` from adapter | Can look like “zero items” rather than “error” |
| AI no data / count 0 | Summary `null` | No AI prose |
| Flow / LLM failure | Logged (`dashboard_category_flow_error`); summary `null` | Card shows summary error / empty when set |
| CoT-only model output | Stripped to empty → `null` | No prose until next successful generate |

Implications:

- Aggressive UI refresh still hits the **60s** category cache unless cleared.
- AI refresh still hits the **5 min** summary cache / disk file.
- Empty vs failed is not always distinguishable for plugins that return the
  adapter’s empty fallback.
- IMAP (and other network backends) dominate tail latency for email; other
  categories stay independent thanks to parallel category loads.

## Card rendering (native app)

Swift models mirror core types in
`apps/toby-app/Sources/TobyApp/Models/DashboardModels.swift`. Cards live under
`apps/toby-app/Sources/TobyApp/Features/Dashboard/`.

| UI element | Source field |
| --- | --- |
| Badge number | `category.count` |
| Per-account rows | `category.sources[]` (`providerDisplayName`, `iconUrl`, `launchUrl`) |
| Item list | `category.items[]` |
| Group chips | `category.groups[]` (ids namespaced as `providerName:…`) |
| “As of …” | `category.generatedAt` |
| AI blurb | `DashboardCategoryAiSummary.text` (from flow) |

Onboarding checklist is separate (local readiness steps), not driven by
standard tools or flows.

## Key files

| Area | Path |
| --- | --- |
| Types / standard tool IDs | `packages/core/src/dashboard/types.ts` |
| Zod validation | `packages/core/src/dashboard/schema.ts` |
| Aggregator + 60s cache | `packages/core/src/dashboard/index.ts` |
| Category prompts / persona | `packages/core/src/dashboard/prompts.ts` |
| AI summaries + flow invoke | `packages/core/src/dashboard/summarizer.ts` |
| Flow runtime | `packages/core/src/flows/` |
| Dashboard flow seeds + store | `packages/core/src/flows/builtins.ts`, `definition-store.ts` |
| HTTP handlers | `packages/core/src/web/handlers/dashboard.ts` |
| Hook synthesis | `packages/core/src/integrations/plugins/adapter.ts` (`buildPluginDashboardHook`) |
| Module type | `packages/core/src/integrations/types.ts` (`dashboard?`) |
| Email tool | `apps/plugin-email/src/tools.ts` (`getUnreadSummary`) |
| Email IMAP unread | `apps/plugin-email/src/client.ts` (`fetchUnreadInbox`) |
| Swift store | `apps/toby-app/Sources/TobyApp/Stores/DashboardStore.swift` |
| Cards / home view | `apps/toby-app/Sources/TobyApp/Features/Dashboard/` |
| Contract + plugin checklist | [`dashboard-standard-tools-plan.md`](dashboard-standard-tools-plan.md) |
| Flow pipelines | [`flows.md`](flows.md) |

## Related docs

- [`flows.md`](flows.md) — named pipelines, node types, dashboard flows  
- [`server-api.md`](server-api.md) — route list for the local daemon API  
- [`integrations.md`](integrations.md) — `IntegrationModule` and plugins  
- [`create-integration.md`](create-integration.md) — adding a new plugin  
- [`architecture.md`](architecture.md) — app-local dashboard visibility prefs  
- Help site (user-facing card visibility): `apps/help-site/docs/toby-app.md`  
