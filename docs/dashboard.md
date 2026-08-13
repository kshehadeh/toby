# Home dashboard

How Toby.app’s home-screen cards (unread mail, tasks, upcoming calendar) get
their content.

## Architecture

> **A card’s definition owns a static header (title and actions); its body is
> always flow output, refreshed by a single update path.**

| Piece | Source | Changes on refresh? |
| --- | --- | --- |
| Header title, icon, actions | Card **definition** (`DashboardBlockDescriptor`) | No |
| Header last-run time | `DashboardBlockContent.generatedAt` (short date + `HH:mm`) | Yes, when content updates |
| Body | **Flow output** (`DashboardBlockContent`) | Yes — one path |
| Count badge | — | Removed (not part of the model) |

There is **no** separate client path for “list/count data” vs “AI blurb.”
Standard tools and the aggregator still run **inside** the flow (and server
content handler); the home UI never dual-fetches them.

Related docs:

| Topic | Doc |
| --- | --- |
| Flow / pipeline design | [`flows.md`](flows.md) |
| Standard tool contract & plugin checklist | [`dashboard-standard-tools-plan.md`](dashboard-standard-tools-plan.md) |

## Card definition (static)

Compile-time registration in Toby.app
(`DashboardBlockDescriptor` / `DashboardBlockID`):

- `id`, `title`, `systemImage`
- empty-state copy (`emptyWhenNil` / `emptyWhenZero`)
- visibility defaults key, sort order, accessibility id
- action metadata (`openPrimaryTitle`, `listsSourceOpenActions`, fallbacks)

The header **title** comes only from the definition. The **last-run** timestamp
in the header is formatted from content `generatedAt` (locale short date +
24-hour `HH:mm`) when content is present. Actions are declared by the block
(open app, chat hooks); enablement may use light **meta** from the latest
content (e.g. `count > 0` for “Summarize all in chat”).

## Block content (refreshable)

Single DTO from the daemon:

```ts
interface DashboardBlockContent {
  category: string;       // block id: "email" | "tasks" | "calendar"
  text: string;           // markdown body; empty when nothing to show
  generatedAt: string;    // ISO 8601 — shown in header as short date + HH:mm
  personaName: string;
  count: number;          // for empty UX / action enablement (not a badge)
  launchUrls: string[];
  sources?: {             // multi-provider open targets
    providerName: string;
    providerDisplayName: string;
    launchUrl?: string;
  }[];
}
```

| API response | Meaning |
| --- | --- |
| JSON `null` | Unknown category, or no connected providers |
| `count === 0` / empty `text` | Connected but nothing to show → definition empty copy |
| Non-empty `text` | Flow markdown for the body |

## Single update path

```
DashboardView / card refresh / toolbar refresh
        │
        ▼
CategoryDashboardBlock.update(force)
        │
        ▼
GET /api/dashboard/:category/content[?fresh=1]
  (alias: …/summary)
        │
        ▼
getDashboardBlockContent(category, { force? })
        │
        ├─ getDashboardCategory (server-internal; 60s cache unless force)
        ├─ count === 0 → empty content (no LLM)
        ├─ soft: memory (5 min) / disk (~/.toby/dashboard-summaries.json)
        └─ else: runFlow("dashboard.<category>.summary")
              Tool Executor (standard tool) → LLM Prompter → { markdown }
        │
        ▼
DashboardBlockContent → card body
```

### UI triggers

| Trigger | Path | Cache |
| --- | --- | --- |
| Home appears and daemon is ready | `store.updateAll(force: false)` → each `block.update(false)` | Soft |
| Card refresh | `block.update(force: true)` | `?fresh=1` |
| Toolbar refresh | `store.refreshAll()` → fan-out `update(true)` (+ shared app stores) | `?fresh=1` |

Global refresh is **not** a second system: it iterates registered blocks and
calls each block’s force update in parallel.

## Categories and flows

| Category | Standard tool (inside flow) | Flow id |
| --- | --- | --- |
| `email` | `email.unreadSummary` | `dashboard.email.summary` |
| `tasks` | `tasks.openSummary` | `dashboard.tasks.summary` |
| `calendar` | `calendar.upcomingSummary` | `dashboard.calendar.summary` |

Plugins declare `providerCategories` and tag a tool with `standardTool`. Core
synthesizes a dashboard hook used by the aggregator / tool executor. See the
[standard tools plan](dashboard-standard-tools-plan.md).

## HTTP API

| Method | Path | Role |
| --- | --- | --- |
| `GET` | `/api/dashboard/:category/content` | **Home card body** (preferred) |
| `GET` | `/api/dashboard/:category/summary` | Alias of `/content` |
| `GET` | `/api/dashboard/:category` | Aggregator list (internal / debug; not home cards) |
| `GET` | `/api/dashboard` | All categories’ aggregator data |

Query: `?fresh=1` bypasses caches and awaits a fresh flow when generating body text.

## Caching

| Layer | TTL | Notes |
| --- | --- | --- |
| Aggregator category cache | 60s | Server-internal; bypassed with `force` / `fresh=1` |
| Content memory cache | 5 min | Keyed by category + persona + data signature |
| Disk | `~/.toby/dashboard-summaries.json` | Soft path may return stale then refresh in background |

## Key files

| Area | Path |
| --- | --- |
| Content types | `packages/core/src/dashboard/types.ts` (`DashboardBlockContent`) |
| Content generation | `packages/core/src/dashboard/summarizer.ts` (`getDashboardBlockContent`) |
| CoT / reasoning strip | `extractDashboardSummaryText` in summarizer (post-process) |

## Model choice (reasoning leaks)

Dashboard cards use short free-form markdown via flow **LLM Prompter** nodes.
Reasoning models (for example Grok 4.5) often write chain-of-thought, skill
metadata, or planning into `text` instead of a separate reasoning channel.

Mitigations in code:

1. Built-in dashboard flows do **not** append the skills catalog (reduces meta echo).
2. `extractDashboardSummaryText` strips think tags, fidelity matrices, skill
   crumbs, and planning monologue before the card body is cached.
3. We deliberately **do not** send `reasoning: "none"` / `reasoning_effort: none`
   — several models (including Grok 4.5) reject that value as invalid.

**Config recommendation:** set the Dashboard persona to a **non-reasoning**
model (no **· reasoning** label in the picker). See Settings → Dashboard.
| Aggregator (internal) | `packages/core/src/dashboard/index.ts` |
| HTTP | `packages/core/src/web/handlers/dashboard.ts` |
| Flows | `packages/core/src/flows/` — see [`flows.md`](flows.md) |
| Card definition | `apps/toby-app/.../Dashboard/DashboardBlock.swift` |
| Block controller | `apps/toby-app/.../Dashboard/CategoryDashboardBlock.swift` |
| Store (fan-out) | `apps/toby-app/.../Stores/DashboardStore.swift` |
| Card UI | `apps/toby-app/.../Dashboard/DashboardCards.swift` |

## Related

- [`server-api.md`](server-api.md) — route list
- [`integrations.md`](integrations.md) — `dashboard?` hook
- Help site: `apps/help-site/docs/toby-app.md` (user-facing card visibility)
