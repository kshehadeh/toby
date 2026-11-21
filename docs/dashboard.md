# Home dashboard

What Toby.app's Home screen shows and where its content comes from.

Home has three parts:

| Part | Content | Notes |
| --- | --- | --- |
| Greeting | Time-of-day greeting and date | Static |
| Onboarding checklist | Setup steps | Shown until complete or hidden |
| **The Feed** | Ranked, cross-connection items with reasons and actions | Always on; the only content section |
| **Actions** sidebar | Tiles for custom flows with a Home Screen Action | Trailing inspector column |

Flows cannot add cards to Home. The built-in mail / tasks / calendar / Toby
Todos summary cards, custom "informational" flow cards, and the client-local
**Continue working** card were removed; The Feed covers what they did. See
[The Feed](feed-plan.md) for how it collects and ranks items.

Related docs:

| Topic | Doc |
| --- | --- |
| Flow / pipeline design | [`flows.md`](flows.md) |
| Standard tool contract & plugin checklist | [`dashboard-standard-tools-plan.md`](dashboard-standard-tools-plan.md) |

## The Feed

The Feed renders in the shared `DashboardCard` shell (content-background fill,
16pt corners, quiet hairline, `intelligenceOutline` while updating). It cannot
be hidden. When no structured-output model is configured, it shows its own
setup prompt (`status: "setupRequired"`) linking to Settings → Home.

The Feed always shows at its full height; scroll Home to reach the rest of it.
Each item shows a source line (connection, then sender / list / project).

### Guiding The Feed

**Guide The Feed** (Home toolbar, `text.badge.star`, also in the Feed card
menu) opens a sheet listing the user's instructions, newest first, with an
on/off switch and delete for each, and a field to add one. Instructions are
stored in Feed state (`instructions`, never pruned; up to 50, 500 characters
each). Enabled ones open the ranking system prompt as **USER INSTRUCTIONS**
(above the default rules, which they override): exclusions ("ignore", "skip",
"only show") are hard filters, and missing facts mean "the user's own item".
They are repeated after the candidate list. Memories and "Not relevant" marks
stay soft hints further down.

To make instructions checkable, each candidate in the prompt carries
`source:` (connection display name, e.g. Todoist), `from/list:` (sender, list,
project), and, for tasks in shared lists, `assigned:` (from the item's `task`
facts — see [feed-plan.md](feed-plan.md)).

Instructions change the personalization signature, so closing the sheet after
a change force-refreshes The Feed. They only steer the ranker: candidates the
pre-filter drops (per-category caps, horizons) never reach it.

Home soft-loads The Feed when the daemon is ready, re-polls every five minutes
while Home is open, and force-refreshes from the toolbar refresh button
(`?fresh=1`).

The Feed reads provider data in-process through the aggregator
(`getDashboardCategory`), which calls each connected plugin's standard summary
tool. See the [standard tools plan](dashboard-standard-tools-plan.md).

## Actions sidebar

A custom flow appears as an Actions tile when it has an enabled `home.action`
trigger, which pairs with a `{ type: "dashboard", variant: "runner" }`
destination (saving either configures both). Toby.app syncs
`GET /api/dashboard/flow-blocks` on each Home load and whenever flow
definitions change.

Tiles are colored Shortcuts-style cards with the flow SF Symbol, play glyph, and
name. Hovering for 1s shows the title and description in a system popover. A
tile never auto-runs; clicking it calls `POST /api/flows/:id/run` and shows a
spinner (with a subtle pulse unless Reduce Motion) while the run is in flight.
The context menu includes **Open flow**. The sidebar is omitted when no tiles
are visible.

The Home toolbar has **Hide Actions** / **Show Actions** (trailing sidebar
icon) whenever at least one tile is registered. It collapses the column
without hiding individual tiles.

### Edit Home

**Edit Home** (toolbar, shown when there is at least one tile) is session-only;
click **Done**, press Escape, or leave Home to exit. While editing, The Feed is
dimmed and non-interactive, and each tile shows:

- a palette control that writes an app-local color override (**Use default**
  removes it; **Neutral** removes the tint even when the flow chooses a color)
- a hide control

Hidden tiles appear in a **Hidden actions** tray below The Feed, each with
**Show**.

### Tile colors

The flow editor's Home destination has a **Home color** default stored as
`destinations[].color`: `neutral`, `teal`, `blue`, `green`, `orange`, `purple`,
`pink`, `red`, or `gray`. **Automatic** omits the field. The flow-block API
exposes it as `dashboardColor`. Tiles without a default use the flow-level
`color` (teal fallback).

## Layout preferences (app-local)

Stored in `UserDefaults` key `toby.appearance.dashboardLayout`
(`AppearancePreferences`), not in `~/.toby`:

```json
{
  "hidden": ["flow.focus"],
  "colorOverrides": {"flow.wrap-up": "blue"},
  "actionsVisible": true,
  "actionsWidth": 156
}
```

| Field | Meaning |
| --- | --- |
| `hidden` | Tile ids (flow ids) hidden from the Actions sidebar. |
| `colorOverrides` | Tile id → palette color or `neutral`. Missing entries inherit the flow default. |
| `actionsVisible` | Whether the Actions column is shown. Default `true`. |
| `actionsWidth` | Preferred column width in points (default 156, clamped 120–280). Live divider drags are handled by the system split view and must not write back mid-drag. |

Older documents also carried a card `order`; it is ignored when decoding.
Unknown ids are ignored. **Reset Home layout** in Settings → Home restores the
empty document.

Onboarding is separate: hide it from the checklist header (**Hide**) or with
**Hide onboarding checklist** in Settings → Home. Both write
`toby.appearance.hideOnboarding`.

## Retired Home cards in older flows

Flows saved before this change may still have an informational dashboard
destination or a `dashboard.refresh` ("Home refresh") trigger. They still load
and appear in the Flows list, but:

- Nothing emits `dashboard.refresh`, so that trigger never runs.
- `validateUserFlowDocument` rejects both, so the flow can't be saved until
  they are removed. The flow editor shows a notice with a one-click
  **Remove Home card settings**.
- They never appear on Home.

The retired built-in `dashboard.*.summary` flow rows are pruned on startup.

## HTTP API

| Method | Path | Role |
| --- | --- | --- |
| `GET` | `/api/dashboard/feed` | The Feed (`?fresh=1` re-collects and re-ranks) |
| `POST` | `/api/dashboard/feed/actions` | Run a Feed item action |
| `GET`, `POST` | `/api/dashboard/feed/instructions` | List / add Feed instructions (`{ text }`) |
| `PATCH`, `DELETE` | `/api/dashboard/feed/instructions/:id` | Turn one on or off (`{ enabled }`) / delete it |
| `GET` | `/api/dashboard/flow-blocks` | Custom flows shown as Home Actions |
| `GET` | `/api/dashboard/:category` | Aggregator list for one category (internal / debug) |
| `GET` | `/api/dashboard` | All categories' aggregator data (internal / debug) |

## Key files

| Area | Path |
| --- | --- |
| Aggregator | `packages/core/src/dashboard/index.ts` |
| Home Actions list | `packages/core/src/dashboard/flow-blocks.ts` |
| The Feed | `packages/core/src/feed/` |
| HTTP | `packages/core/src/web/handlers/dashboard.ts` |
| Home view | `apps/toby-app/.../Dashboard/DashboardView.swift` |
| Feed UI | `apps/toby-app/.../Dashboard/Feed/FeedCardView.swift` |
| Store | `apps/toby-app/.../Stores/DashboardStore.swift` |
| Tile model / registry | `apps/toby-app/.../Dashboard/DashboardBlock.swift`, `CategoryDashboardBlock.swift`, `DashboardBlockRegistry.swift` |
| Actions sidebar | `apps/toby-app/.../Dashboard/DashboardActionRunnersRail.swift` |
| Edit chrome / hidden tray | `apps/toby-app/.../Dashboard/DashboardEditChrome.swift` |
| Layout document | `apps/toby-app/.../Dashboard/DashboardLayout.swift` |

## Related

- [`server-api.md`](server-api.md) — route list
- [`integrations.md`](integrations.md) — `dashboard?` hook
- Help site: `apps/help-site/docs/toby-app.md`
