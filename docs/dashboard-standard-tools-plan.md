# Dashboard standard data tools — implementation reference

Status: **implemented** (v1). This document is the independent source of truth
for the dashboard data contract, API surface, and plugin implementation
checklist. The native SwiftUI UI can be built from this document alone without
reading the core TypeScript implementation.

## Problem

The home-screen dashboard (unread mail card, tasks card, onboarding
checklist) needs to pull "what needs your attention" data from whichever
email and task plugins the user has connected — deterministically, on a
timer, without going through the AI chat pipeline.

Every plugin invents its own tool names and result shapes for the same
underlying concept. The standard tools contract adds a reserved, versioned
data contract per provider category so any non-AI consumer can call it and
get a predictable shape back.

## Decisions (v1)

- **Per-source rows**: multiple providers in the same category are preserved
  as per-source rows in the API response, with a category-level total for
  simple cards.
- **Cache TTL**: 60 seconds for on-demand dashboard refreshes.
- **`groups`**: included in v1 as an optional field. Providers may return no
  groups until they have deterministic buckets (folders, labels, lists).
- **No AI in the loop**: all urgency/grouping is deterministic (overdue,
  flagged, starred, list membership). AI-assisted triage is a future opt-in
  layer.

## Standard tool IDs

Each provider category maps to a reserved standard tool ID:

| Provider category | Standard tool ID |
| --- | --- |
| `email` | `email.unreadSummary` |
| `tasks` | `tasks.openSummary` |
| `calendar` (future) | `calendar.upcomingSummary` |
| `work_tracker` (future) | `work_tracker.openSummary` |

A plugin tags one of its tool definitions with `standardTool: "<id>"` to
indicate it fulfills that contract. The tool's `name` can be anything — the
dashboard dispatch finds it by the tag, not by name.

### Reserved input

```json
{ "limit": 20 }
```

`limit` is optional. Default is 20. The dashboard aggregator caps items at
100 per category after merging all sources.

### Reserved output (plugin tool `result`)

```ts
interface DashboardSummaryResult {
  count: number;
  groups?: { id: string; label: string; count: number }[];
  items: DashboardItem[];
  generatedAt: string; // ISO 8601
}

interface DashboardItem {
  id: string;           // opaque, stable — round-trips back to the plugin
  title: string;        // subject / task content
  subtitle?: string;    // sender / project / list name
  detail?: string;      // snippet / description
  timestamp?: string;   // ISO 8601 — received date / due date
  urgency?: "low" | "normal" | "high";
  url?: string;         // deep link
  groupId?: string;     // ties back to groups[].id
}
```

**`urgency` rules**: deterministic only. `\Flagged` IMAP flag = high.
Todoist priority 4 = high. Overdue due date = high. Never AI-inferred.

**`groups` rules**: deterministic buckets the source already has (Gmail
labels, IMAP folders, Todoist projects, Reminders lists). If the source
has no such signal, omit `groups` entirely.

## API surface

### `GET /api/dashboard`

Returns aggregated dashboard data from all connected providers.

```ts
interface DashboardData {
  email: DashboardCategorySummary | null;
  tasks: DashboardCategorySummary | null;
}
```

`null` means no connected providers implement the standard tool for that
category.

#### `DashboardCategorySummary`

```ts
interface DashboardCategorySummary {
  count: number;           // sum of all source counts
  sources: DashboardProviderSummary[];  // per-source rows
  items: DashboardItem[];  // merged, timestamp-sorted, capped at 100
  groups: DashboardGroup[]; // union, namespaced by provider
  generatedAt: string;     // ISO 8601 — most recent source timestamp
}

interface DashboardProviderSummary {
  providerName: string;         // integration module name (e.g. "email")
  providerDisplayName: string;  // human-readable (e.g. "Email (IMAP/SMTP)")
  iconUrl?: string;             // optional icon served by local HTTP API
  summary: DashboardSummaryResult;
}
```

#### Merge behavior

- **count**: sum of all source `count` values.
- **sources**: individual provider summaries, one per connected provider
  that responded successfully. Use these for per-account UI rows.
- **items**: all items from all sources concatenated, sorted by `timestamp`
  descending, capped at 100.
- **groups**: union of all source groups. IDs are namespaced as
  `<providerName>:<groupId>` to avoid collisions between providers.
- **generatedAt**: the most recent `generatedAt` across all sources.

#### Failure semantics

- A provider that times out (25s per provider), throws, or returns a
  malformed payload is silently excluded from `sources`. The daemon logs a
  warning. Other providers in the same category are unaffected.
- A category with no connected providers, or where no provider implements
  the standard tool, returns `null`.

#### Caching

The aggregator caches results for 60 seconds. Rapid UI refreshes within
that window receive cached data without re-polling IMAP/APIs. The cache is
keyed by the `limit` parameter.

#### Example response

```json
{
  "email": {
    "count": 95,
    "sources": [
      {
        "providerName": "email",
        "providerDisplayName": "Email (IMAP/SMTP)",
        "iconUrl": "/api/plugins/email/icon",
        "summary": {
          "count": 95,
          "items": [
            {
              "id": "12345:INBOX",
              "title": "Q3 budget review",
              "subtitle": "cfo@example.com",
              "detail": "Please review the attached...",
              "timestamp": "2026-07-05T10:30:00Z",
              "urgency": "high"
            }
          ],
          "generatedAt": "2026-07-05T11:00:00Z"
        }
      }
    ],
    "items": [
      {
        "id": "12345:INBOX",
        "title": "Q3 budget review",
        "subtitle": "cfo@example.com",
        "detail": "Please review the attached...",
        "timestamp": "2026-07-05T10:30:00Z",
        "urgency": "high"
      }
    ],
    "groups": [],
    "generatedAt": "2026-07-05T11:00:00Z"
  },
  "tasks": {
    "count": 4,
    "sources": [
      {
        "providerName": "todoist",
        "providerDisplayName": "Todoist",
        "iconUrl": "/api/plugins/todoist/icon",
        "summary": {
          "count": 3,
          "groups": [
            { "id": "67890", "label": "Work", "count": 2 },
            { "id": "11111", "label": "Personal", "count": 1 }
          ],
          "items": [
            {
              "id": "task-abc",
              "title": "Finish dashboard UI",
              "subtitle": "Work",
              "timestamp": "2026-07-06T09:00:00Z",
              "urgency": "high",
              "url": "https://todoist.com/app/task/abc",
              "groupId": "67890"
            }
          ],
          "generatedAt": "2026-07-05T11:00:00Z"
        }
      },
      {
        "providerName": "applereminders",
        "providerDisplayName": "Apple Reminders",
        "iconUrl": "/api/plugins/applereminders/icon",
        "summary": {
          "count": 1,
          "groups": [
            { "id": "Shopping", "label": "Shopping", "count": 1 }
          ],
          "items": [
            {
              "id": "rem-xyz",
              "title": "Buy milk",
              "subtitle": "Shopping",
              "timestamp": "2026-07-05T18:00:00Z",
              "urgency": "normal",
              "groupId": "Shopping"
            }
          ],
          "generatedAt": "2026-07-05T11:00:00Z"
        }
      }
    ],
    "items": [
      {
        "id": "task-abc",
        "title": "Finish dashboard UI",
        "subtitle": "Work",
        "timestamp": "2026-07-06T09:00:00Z",
        "urgency": "high",
        "url": "https://todoist.com/app/task/abc",
        "groupId": "67890"
      },
      {
        "id": "rem-xyz",
        "title": "Buy milk",
        "subtitle": "Shopping",
        "timestamp": "2026-07-05T18:00:00Z",
        "urgency": "normal",
        "groupId": "Shopping"
      }
    ],
    "groups": [
      { "id": "todoist:67890", "label": "Work", "count": 2 },
      { "id": "todoist:11111", "label": "Personal", "count": 1 },
      { "id": "applereminders:Shopping", "label": "Shopping", "count": 1 }
    ],
    "generatedAt": "2026-07-05T11:00:00Z"
  }
}
```

## SwiftUI consumption guide

The native app dashboard has two data paths:

- Integration-backed cards call `GET /api/dashboard` or
  `GET /api/dashboard/:category` on view appear and refresh. The dashboard
  cache TTL is 60s, so refresh controls should not expect provider data to
  change more often unless the cache is explicitly cleared.
- Local app counts and shortcuts (sessions, schedules, recordings, memories,
  skills, projects, and integration sections) come from shared root-scoped
  stores. Toby.app preloads those list/index stores after daemon bootstrap and
  refreshes them with the dashboard refresh action. Feature views should use
  idempotent `ensureLoaded()` fallbacks instead of being the only path that
  populates shared data.

Keep detail payloads lazy. Recording transcripts, memory detail/explanations,
skill bodies, project file trees, and schedule run transcripts should load only
when the user opens the corresponding detail surface.

### Card rendering

1. **Badge number**: use `category.count` for the card's headline number
   (e.g. "95 unread", "4 open").
2. **Per-source rows**: iterate `category.sources` if you want to show
   per-account rows (e.g. "Gmail: 80" / "Fastmail: 15"). Use
   `source.providerDisplayName` and `source.iconUrl` for the row label/icon.
3. **Item list**: use `category.items` for the main list. Sort is already
   timestamp-descending. Each item has `title`, `subtitle`, `detail`,
   `timestamp`, `urgency`, `url`, and `groupId`.
4. **Group chips**: use `category.groups` for filter/bucket chips. Each
   group has `id` (namespaced as `providerName:originalId`), `label`, and
   `count`. Filter items by matching `item.groupId` to the original
   (un-namespaced) group ID — the suffix after `:` in `group.id`.
5. **"As of" label**: use `category.generatedAt` to show "as of 2 minutes
   ago".
6. **Urgency indicator**: map `urgency: "high"` to a red dot or flag icon.
   `"normal"` and `"low"` can be unstyled or muted.
7. **Deep links**: if `item.url` is present, tapping the item opens it.

### Null handling

If a category is `null`, show an empty state card (e.g. "No email connected"
or "Connect a task list to see your open tasks here").

## Plugin implementation checklist

To add dashboard support to a new or existing plugin:

1. **Add a standard tool** to your plugin's `TOOL_DEFINITIONS`:
   ```ts
   {
     name: "getUnreadSummary",  // any name
     displayName: "Unread summary",
     description: "...",
     readOnly: true,
     standardTool: "email.unreadSummary",  // the reserved ID
     inputSchema: {
       type: "object",
       properties: {
         limit: { type: "number", description: "Max items (default 20)" }
       }
     }
   }
   ```

2. **Implement the tool execution** in your plugin's `executeTool` switch.
   Return a `DashboardSummaryResult`:
   ```ts
   case "getUnreadSummary": {
     const limit = Number(input.limit ?? 20) || 20;
     // fetch data from your source
     return {
       result: {
         count: /* total unread */,
         items: /* mapped to DashboardItem[] */,
         groups: /* optional, deterministic only */,
         generatedAt: new Date().toISOString(),
       }
     };
   }
   ```

3. **Map your data to `DashboardItem`**:
   - `id`: stable, opaque identifier
   - `title`: subject / task content
   - `subtitle`: sender / project / list name
   - `detail`: snippet / description (truncated)
   - `timestamp`: ISO 8601 received/due date
   - `urgency`: "high" only for deterministic signals (flagged, overdue,
     priority 4). Never AI-inferred.
   - `url`: deep link if available
   - `groupId`: ties to a group `id` if you return `groups`

4. **No protocol version bump needed**: the `standardTool` field is a
   backward-compatible addition to `PluginToolDefinition`. Existing plugins
   without it simply don't contribute to dashboard cards.

## Enforcement

### Soft (v1)

- **`toby plugins doctor`**: emits a warning if a plugin declares
  `providerCategories: ["email"]` but no tool carries
  `standardTool: "email.unreadSummary"`. Same for `tasks`.
- **Runtime shape validation**: plugin results are validated against a zod
  schema. Malformed payloads are logged and treated as "no data" for that
  card.

### Hard (future)

- After all first-party plugins comply, the doctor warning can be promoted
  to a hard install-time failure for new plugins declaring those categories.

## First-party plugin implementations

### plugin-email (`email.unreadSummary`)

- Tool: `getUnreadSummary` (read-only, tagged `email.unreadSummary`)
- Queries unread INBOX messages from the local SQLite cache
- `urgency: "high"` for messages with `\Flagged` IMAP flag
- No `groups` in v1 (IMAP flags don't map to meaningful buckets)
- Items: `id` = `uid:mailbox`, `title` = subject, `subtitle` = from address,
  `detail` = snippet, `timestamp` = date

### plugin-todoist (`tasks.openSummary`)

- Tool: `getOpenTasksSummary` (read-only, tagged `tasks.openSummary`)
- Fetches open tasks via Todoist API, maps to dashboard items
- `groups`: one per Todoist project (id = project ID, label = project name)
- `urgency: "high"` for priority 4 tasks or overdue tasks
- Items: `id` = task ID, `title` = content, `subtitle` = project name,
  `detail` = description, `timestamp` = due date, `url` = task URL,
  `groupId` = project ID

### plugin-applereminders (`tasks.openSummary`)

- Tool: `getOpenRemindersSummary` (read-only, tagged `tasks.openSummary`)
- Queries incomplete reminders via Toby.app native API
- `groups`: one per reminder list (id = list name, label = list name)
- `urgency: "high"` for priority 1 (EventKit high) or overdue reminders
- Items: `id` = reminder ID, `title` = title, `subtitle` = list name,
  `detail` = notes, `timestamp` = due date, `url` = reminder URL,
  `groupId` = list name

## Architecture

```mermaid
flowchart TD
  App[Toby.app UI] --> Api[GET /api/dashboard]
  Api --> Agg[dashboard aggregator]
  Agg --> Mods[connected modules]
  Mods --> Hook[dashboard hook]
  Hook --> Exec[tools execute]
  Exec --> Tool[standard tool]
  Tool --> Zod[shape validation]
  Zod --> Agg
```

### Key files

| File | Purpose |
| --- | --- |
| `packages/core/src/dashboard/types.ts` | Contract types: `StandardToolId`, `DashboardSummaryResult`, `DashboardItem`, `DashboardCategorySummary`, `DashboardData` |
| `packages/core/src/dashboard/schema.ts` | Zod validation for plugin results |
| `packages/core/src/dashboard/index.ts` | Aggregator: `getDashboardData()`, caching, per-provider timeout |
| `packages/core/src/integrations/types.ts` | `IntegrationModule.dashboard` hook |
| `packages/core/src/integrations/plugins/protocol.ts` | `PluginToolDefinition.standardTool` field |
| `packages/core/src/integrations/plugins/adapter.ts` | `buildPluginDashboardHook()` — synthesizes dashboard hook for installable plugins |
| `packages/core/src/integrations/plugins/validate.ts` | `checkStandardToolCompliance()` — doctor warning |
| `packages/core/src/web/handlers/dashboard.ts` | `handleDashboard()` — HTTP handler |
| `packages/core/src/web/routes.ts` | `GET /api/dashboard` route |

## Future extensions

- `calendar.upcomingSummary` for calendar providers (Apple Calendar, Google
  Calendar)
- `work_tracker.openSummary` for work trackers (Jira, Linear)
- AI-assisted triage as an opt-in layer on top of this deterministic data
- Promoting the doctor warning to a hard install-time failure
