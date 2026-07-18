# Home dashboard data population

How Toby.app’s home-screen cards (unread mail, tasks, upcoming calendar) get
their data. The chat pipeline is **not** involved: cards pull deterministic
plugin summaries over the local daemon HTTP API, then optionally request a
separate AI text summary.

For the reserved tool contract, merge rules, and plugin implementation
checklist, see also
[`dashboard-standard-tools-plan.md`](dashboard-standard-tools-plan.md).

## Overview

Each integration-backed card is a **category** (`email`, `tasks`, `calendar`).
A category may be fed by multiple plugins (for example Todoist and Apple
Reminders both contribute to `tasks`). Plugins declare a
`providerCategories` value and tag one tool with a reserved `standardTool` ID;
core synthesizes a `dashboard.getSummary` hook that executes that tool without
an LLM.

| Category | Standard tool ID | Example plugins |
| --- | --- | --- |
| `email` | `email.unreadSummary` | `email` (IMAP/SMTP) |
| `tasks` | `tasks.openSummary` | `todoist`, `applereminders` |
| `calendar` | `calendar.upcomingSummary` | `applecalendar` |

There are **two independent data paths** per category:

1. **Deterministic summary** — count, items, sources, groups (no AI)
2. **AI summary** — short markdown generated from that data (persona-driven)

## End-to-end flow

```
DashboardView (.task / refresh button)
        │
        ▼
DashboardStore  (per-category parallel load)
        │
        ▼
TobyClient
  GET /api/dashboard/:category
  GET /api/dashboard/:category/summary   ← AI path only
        │
        ▼
Daemon handlers → getDashboardCategory / getDashboardCategorySummary
        │
        ▼
Aggregator: connected modules with providerCategories + dashboard hook
        │
        ▼
module.dashboard.getSummary({ limit })
        │
        ▼
Plugin adapter: find tool by standardTool tag → tools execute
        │
        ▼
Plugin tool returns DashboardSummaryResult → Zod validate → merge → cache
        │
        ▼
JSON → DashboardStore → card UI (e.g. UnreadMailCard)
```

## When the UI refreshes

| Trigger | Code path | What loads |
| --- | --- | --- |
| Home dashboard appears | `DashboardView.task` | `store.load()` then `store.loadSummariesIfStale()` |
| Global refresh | `RootView.refreshDashboardData()` | `load()` + shared app stores + `reloadSummaries()` |
| Card refresh button | e.g. `store.refreshEmail()` | That category’s data **then** its AI summary |

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
| `GET` | `/api/dashboard/:category` | One category summary, or `null` |
| `GET` | `/api/dashboard/:category/summary` | AI summary for one category, or `null` |

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

### Reserved result shape (summary)

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

Concrete path for the Unread Mail block.

### 1. Plugin declaration

`apps/plugin-email/manifest.json`:

- `providerCategories: ["email"]`
- Capabilities/chat as usual; no special dashboard field in the manifest

### 2. Standard tool

`apps/plugin-email/src/tools.ts` defines `getUnreadSummary` with
`standardTool: "email.unreadSummary"`. Input is optional `{ limit }`.

### 3. Tool execution

On execute, the email plugin:

1. Calls `fetchUnreadInbox(config, limit)` in
   `apps/plugin-email/src/client.ts`.
2. Opens a live IMAP connection (not the SQLite cache) and:
   - Reads `STATUS INBOX` unseen count
   - Searches unseen UIDs, takes the newest `limit`, fetches envelope + flags
3. Maps messages to items:
   - `id`: `"{uid}:INBOX"`
   - `title`: subject
   - `subtitle`: from
   - `timestamp`: ISO date
   - `urgency`: `"high"` if `\Flagged`, else `"normal"`
4. Optionally sets `launchUrl` from the IMAP host → webmail URL
5. Returns `{ count, items, launchUrl?, generatedAt }`

> Note: the tool’s human description still mentions “local cache”; the
> implementation is **live IMAP** so the badge reflects server unread state
> (messages read or archived elsewhere are excluded).

### 4. Aggregation and UI

- Aggregator includes the `email` module if connected and the hook succeeds.
- Swift `UnreadMailCard` binds to `store.email` (badge, sources, items) and
  `store.emailSummary` (AI markdown / skeleton).
- Card refresh: `refreshEmail()` → `loadEmail()` then `loadEmailSummary()`.

## AI summary path

Implementation: `packages/core/src/dashboard/summarizer.ts`.

Separate from the deterministic aggregator. Used for the prose under each card.

1. Load category data via `getDashboardCategory(category, { limit: 50 })`
   (shares the 60s category cache).
2. If no data or `count === 0` → `null`.
3. Cache key: `category` + dashboard persona + **data signature** (count,
   `generatedAt`, item ids/titles/timestamps).
4. **In-memory AI cache TTL: 5 minutes**.
5. Fallback file: `~/.toby/dashboard-summaries.json` so after a daemon restart
   the UI can show the last summary immediately while a background refresh
   runs.
6. Persona: `config.dashboard.persona`, else default persona.
7. Built-in category prompts (email / tasks / calendar) + persona system
   prompt + skills catalog; `generateText` with a timeout (30s), no tools.
8. Output is sanitized to strip common chain-of-thought / planning leakage
   (`extractDashboardSummaryText`).

Config UI: configure tree key `dashboard.persona` (Settings / configure
persistence).

## Failure and empty-state semantics

| Situation | Aggregator / API behavior | Typical UI effect |
| --- | --- | --- |
| No module for category | Category `null` | Empty / connect prompt (store may keep last value if previously set) |
| Module not connected | Skipped | Same as no sources if all skipped |
| Provider timeout (25s) | Excluded from `sources` | Other providers still show |
| Provider throw | Logged + excluded | Same |
| Tool exec / Zod failure | Empty summary `{ count: 0, items: [] }` from adapter | Can look like “zero items” rather than “error” |
| AI no data / count 0 | Summary `null` | No AI prose |
| AI generation fail | Error path / null depending on layer | Card shows summary error state when set |

Implications for reliability work:

- Aggressive UI refresh still hits the **60s** category cache unless cleared.
- Empty vs failed is not always distinguishable for plugins that return the
  adapter’s empty fallback.
- IMAP (and other network backends) dominate tail latency for email; other
  categories stay independent thanks to parallel category loads.

## Card rendering (native app)

Swift models mirror core types in
`apps/toby-app/Sources/TobyApp/Models/DashboardModels.swift`. Cards live under
`apps/toby-app/Sources/TobyApp/Features/Dashboard/`.

Practical mapping:

| UI element | Source field |
| --- | --- |
| Badge number | `category.count` |
| Per-account rows | `category.sources[]` (`providerDisplayName`, `iconUrl`, `launchUrl`) |
| Item list | `category.items[]` |
| Group chips | `category.groups[]` (ids namespaced as `providerName:…`) |
| “As of …” | `category.generatedAt` |
| AI blurb | `DashboardCategoryAiSummary.text` |

Onboarding checklist is separate (local readiness steps), not driven by
standard tools.

## Key files

| Area | Path |
| --- | --- |
| Types / standard tool IDs | `packages/core/src/dashboard/types.ts` |
| Zod validation | `packages/core/src/dashboard/schema.ts` |
| Aggregator + 60s cache | `packages/core/src/dashboard/index.ts` |
| AI summaries | `packages/core/src/dashboard/summarizer.ts` |
| HTTP handlers | `packages/core/src/web/handlers/dashboard.ts` |
| Hook synthesis | `packages/core/src/integrations/plugins/adapter.ts` (`buildPluginDashboardHook`) |
| Module type | `packages/core/src/integrations/types.ts` (`dashboard?`) |
| Email tool | `apps/plugin-email/src/tools.ts` (`getUnreadSummary`) |
| Email IMAP unread | `apps/plugin-email/src/client.ts` (`fetchUnreadInbox`) |
| Swift store | `apps/toby-app/Sources/TobyApp/Stores/DashboardStore.swift` |
| Cards / home view | `apps/toby-app/Sources/TobyApp/Features/Dashboard/` |
| Contract + plugin checklist | [`dashboard-standard-tools-plan.md`](dashboard-standard-tools-plan.md) |

## Related docs

- [`server-api.md`](server-api.md) — route list for the local daemon API
- [`integrations.md`](integrations.md) — `IntegrationModule` and plugins
- [`create-integration.md`](create-integration.md) — adding a new plugin
- [`architecture.md`](architecture.md) — app-local dashboard visibility prefs
- Help site (user-facing card visibility): `apps/help-site/docs/toby-app.md`
