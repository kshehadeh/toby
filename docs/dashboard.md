# Home dashboard

How Toby.app’s home-screen cards (unread mail, tasks, upcoming calendar, and
optional custom-flow cards) get their content.

## Architecture

> **A card’s definition owns a static header (title and actions); its body is
> always flow output, refreshed by a single update path.**

| Piece | Source | Changes on refresh? |
| --- | --- | --- |
| Header title, icon, actions | Card **definition** (`DashboardBlockDescriptor`) | No |
| Header last-run time | `DashboardBlockContent.generatedAt` (short date + `HH:mm`) | Yes, when content updates |
| Body | **Flow output** (`DashboardBlockContent`), with optional derived sections | Yes — one path |
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
- visibility defaults key (legacy; layout JSON is source of truth), default sort index, accessibility id
- action metadata (`openPrimaryTitle`, `listsSourceOpenActions`, fallbacks)

The header **title** and leading SF Symbol come only from the definition. The
**last-run** timestamp in the header is formatted from content `generatedAt`
(locale short date + 24-hour `HH:mm`) when content is present.
Actions are declared by the block (open app, chat hooks); enablement may use
light **meta** from the latest content (e.g. `count > 0` for “Summarize all in
chat”).

## Card chrome

Home cards share one visual shell (`DashboardBlockChrome`):

- Content-background fill, 16pt corners, quiet hairline outline and header divider
- While a content card is updating (`isUpdating`), the shared `intelligenceOutline` modifier fades a Siri-style rainbow ring over the hairline and fades it out when the update finishes. Reduce Motion snaps with no fade. Onboarding and Actions runners do not use this treatment. Apply the same modifier to other processing surfaces (chat composer, flow run, etc.) with `isActive` and an optional `Shape`.
- 16px inner padding; cards keep their intrinsic height up to a 340px collapsed cap
- A waterfall layout places each card in the shortest 320–460px column, so compact cards stack beside taller cards
- Summary and structured rows use compact system typography; `##` section
  labels render as small uppercase metadata
- Expanded cards drop a small downward shadow; collapsed overflow uses the
  gradient fade + **Show more** bar
- Flow Markdown is also exposed as optional generic eyebrow/title/body/item
  sections. Toby.app uses those sections for briefing-style hierarchy and
  actionable rows, falling back to the original Markdown for plain output.

Onboarding uses the same shell without a glyph. Runner-variant flows are **not**
cards: they appear in a compact **Actions** rail beside the grid (title button,
hover description, in-flight spinner). The rail is omitted when no runners are
visible.

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
  sections?: {            // derived from headings, prose, bullets, and links
    id: string;
    eyebrow?: string;
    title?: string;
    body?: string;
    items: { title: string; subtitle?: string; url?: string }[];
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

## Layout preferences (app-local)

Toby.app retains card order and visibility preferences without talking to the daemon.
Layout is stored in `UserDefaults` key `toby.appearance.dashboardLayout`
alongside other UI prefs (`AppearancePreferences`), not in `~/.toby` or
server settings.

```json
{
  "order": ["calendar", "email", "tasks"],
  "hidden": ["tasks"],
  "actionsVisible": true,
  "actionsWidth": 156
}
```

| Field | Meaning |
| --- | --- |
| `order` | Last-known sequence of card ids. Empty means default grouping. |
| `hidden` | Card ids not shown on the home grid (including custom flow cards). |
| `actionsVisible` | Whether the Actions inspector is shown (toolbar toggle). Default `true`. Independent of per-runner hide. |
| `actionsWidth` | Preferred Actions inspector width in points (default 156, clamped 120–280). The system divider resizes the column. |

Older documents without the Actions keys load as visible at the default width.

**Default order** when `order` is empty (and after **Reset dashboard layout**):

1. Built-ins by `sortIndex` (email, tasks, calendar)
2. Informational flow cards
3. Runner flows (Actions rail; not grid cells)

The home grid renders only built-ins and informational cards. Visible runners
render in a trailing **inspector** column (SwiftUI `.inspector`) in that same
stored order among themselves, unless the column is collapsed via the toolbar
or the system divider. Hidden runners still appear in the **Hidden cards**
tray. The inspector uses the system split divider; drag it to resize. Visibility is stored on the layout document. The column’s preferred width is
the layout `actionsWidth` (ideal); live divider drags are handled by the
system split view and must not write back during the drag (that invalidates
Auto Layout constraints mid-tracking).

Unknown ids are ignored. Newly registered flow cards that are not listed
append as **visible**. Built-in Settings toggles write the same `hidden`
set; the three legacy `showDashboard*` bool keys are mirrored for
compatibility.

The dashboard toolbar includes **Hide Actions** / **Show Actions** (trailing
sidebar icon) when at least one runner flow is registered. That toggle is
stored as `actionsVisible` and does not hide individual runners.

The previous Home edit/reorder entry point is currently hidden while that
interaction is reconsidered. Existing stored order remains honored, and
Settings → Home visibility toggles continue to work. The underlying layout
document and reorder implementation are intentionally retained so existing
preferences do not require migration.

Onboarding is not part of this layout; it still uses **Hide onboarding
checklist**.

## Continue working

The **Continue working** card participates in the same waterfall layout and
uses the same width and collapsed-height limits as other dashboard blocks. It
merges non-project chat sessions and projects by their most recent update time
and shows up to five rows. Selecting a chat opens that session in Chats;
selecting a project opens its project page. Project chats remain represented by
their project and are not duplicated as chat rows.

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
| `GET` | `/api/dashboard/flow-blocks` | Custom flows with a Dashboard destination |
| `GET` | `/api/dashboard/:category/content` | **Home card body** (preferred; built-in category or custom flow id) |
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

## Custom flow cards

A user-authored flow can add `{ type: "dashboard", variant, refresh? }` as a
destination. Toby.app syncs `GET /api/dashboard/flow-blocks` on each home load
and registers a card whose id is the flow id. Informational `refresh` is
`asNeeded` (default) or `manual`. Runner ignores `refresh`.

Dashboard content generation runs the flow with **no** email/Slack delivery
(`deliverDestinations: false`). Those sinks still fire on **Run now** and
schedules.

| Variant | UI | Load |
| --- | --- | --- |
| `informational` + `asNeeded` | Built-in-sized card. Body is last successful run output. Menu includes **Open flow**. | Soft: last success if younger than 5 min; older last success is returned immediately and a background rerun starts; never-run awaits a run. Force (`?fresh=1`): await rerun. |
| `informational` + `manual` | Same card chrome. | Soft: last success only (no rerun). Force: await rerun. |
| `runner` | Compact **Actions** inspector button (title). Hover shows the flow description in a system popover (same as the server-status button, so it can draw outside the window). Never auto-runs. The button disables with a spinner (and a subtle pulse unless Reduce Motion) while the run is in flight. Context menu includes **Open flow**. The inspector is hidden when no runners are visible. | `POST /api/flows/:id/run`. Content fetch is a no-op. |

Built-in email / tasks / calendar cards are unchanged.

## Key files

| Area | Path |
| --- | --- |
| Content types | `packages/core/src/dashboard/types.ts` (`DashboardBlockContent`) |
| Content generation | `packages/core/src/dashboard/summarizer.ts` (`getDashboardBlockContent`) |
| Custom flow cards | `packages/core/src/dashboard/flow-blocks.ts` |
| CoT / reasoning strip | `extractDashboardSummaryText` in summarizer (post-process) |
| Aggregator (internal) | `packages/core/src/dashboard/index.ts` |
| HTTP | `packages/core/src/web/handlers/dashboard.ts` |
| Flows | `packages/core/src/flows/` — see [`flows.md`](flows.md) |
| Card definition | `apps/toby-app/.../Dashboard/DashboardBlock.swift` |
| Block controller | `apps/toby-app/.../Dashboard/CategoryDashboardBlock.swift` |
| Store (fan-out) | `apps/toby-app/.../Stores/DashboardStore.swift` |
| Card UI | `apps/toby-app/.../Dashboard/DashboardCards.swift` |
| Actions rail | `apps/toby-app/.../Dashboard/DashboardActionRunnersRail.swift` |
| Card chrome | `apps/toby-app/.../Dashboard/DashboardBlockChrome.swift` |
| Layout document | `apps/toby-app/.../Dashboard/DashboardLayout.swift` |
| Edit chrome / card drag | `apps/toby-app/.../Dashboard/DashboardEditChrome.swift` |

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

**Config recommendation:** set the Home persona to a **non-reasoning**
model (no **· reasoning** label in the picker). See Settings → Home.

## Related

- [`server-api.md`](server-api.md) — route list
- [`integrations.md`](integrations.md) — `dashboard?` hook
- Help site: `apps/help-site/docs/toby-app.md` (user-facing card layout and visibility)
