# Apple Calendar integration

First-party integration id: **`applecalendar`**, shipped as the Swift installable plugin **`toby-plugin-applecalendar`** ([`apps/plugin-applecalendar/`](../apps/plugin-applecalendar/)). Release archives and `install-toby.sh` install it under `~/.toby/plugins/`.

## Platform

- **macOS only.** Toby drives **Calendar.app** via native **EventKit** and Calendar.app AppleScript fallbacks on the local Mac. On Linux or Windows the plugin can be installed for tests but chat tools require Calendar.app on a Mac.

## Setup

1. Use a Mac with Calendar.app configured (at least one calendar).
2. Run **`toby connect applecalendar`** once. This stores a "connected" flag under `~/.toby/config.json` after a quick Calendar.app health check.
3. On first real automation, macOS may prompt to allow **Automation** (your terminal or Cursor controlling Calendar). Approve it in **System Settings → Privacy & Security → Automation**.

No API keys are stored; optional notes can be saved under **Configure** as `applecalendar.info`.

## Chat tools

| Tool | Purpose |
| ---- | ------- |
| `listCalendars` | List Calendar.app calendar names and colors; use exact names for the `calendar` filter. |
| `searchCalendarEvents` | Search events by query text, calendar name, date range, and limit. Uses EventKit for fast queries. |
| `getCalendarEvent` | Get full details of a single event by uid, including attendees. |
| `createCalendarEvent` | Create a new event (summary, start/end dates, optional calendar, location, description, allDay). Returns a **uid**. |
| `updateCalendarEvent` | Update an existing event by uid (any subset of fields). |
| `deleteCalendarEvent` | Delete an event by uid. Cannot be undone. |

Event uids are **Calendar.app string identifiers** (e.g. `ABC123-DEF456`), not numeric ids. Prefer uids returned from `searchCalendarEvents` or `createCalendarEvent`.

## AppleScript / EventKit architecture

The plugin uses **native EventKit** (`EKEventStore`) for search, list, get, and CRUD whenever possible. Calendar.app **AppleScript** is used only as a fallback when EventKit cannot complete an operation (see `CalendarClient.swift` in the plugin).

### Search: EventKit (native Swift)

Event search uses `EKEventStore.predicateForEvents(withStart:end:calendars:)` against the local EventKit database. This is ~100x faster than Calendar.app's AppleScript interface for large calendars.

**Why not Calendar.app AppleScript for search?** Calendar.app's `whose` clause (e.g. `events whose start date >= ...`) is **silently ignored** for Exchange and iCloud calendars. The script iterates all events (potentially thousands), which times out. EventKit's predicate-based search works correctly for all calendar types and returns results in under a second.

### Create / Update / Delete / Get: EventKit first, AppleScript fallback

Mutating operations and single-event lookups prefer native `EKEvent` save/remove APIs. When EventKit fails (or an event is not found by identifier), the plugin falls back to Calendar.app AppleScript with the same date-preservation workarounds documented below.

## Known AppleScript pitfalls (for future integrations)

### 1. `whose` clauses are unreliable for Exchange/iCloud

Calendar.app's AppleScript `whose` filters are silently ignored for non-local calendars. Always use EventKit (`EKEventStore`) for date-range queries.

### 2. Setting properties can silently corrupt other properties

Calendar.app has a bug where setting certain properties (e.g. `location`, `description`) inside a `tell evt` block can silently reset `end date` to equal `start date`. The AppleScript fallback in the plugin applies these workarounds:

- **Avoid `tell evt` blocks** — set properties directly on the `evt` variable from outside any tell block.
- **Save start and end dates as scalar integers** (`year`, `month`, `day`, `hours`, `minutes`, `seconds`) before the update, then always explicitly re-set both dates as the final operations after the update.
- **Use `copy` instead of `set`** for date snapshots — `set` creates a reference that can be mutated in-place by Calendar.app; `copy` creates a true deep copy.

### 3. AppleScript `date` command doesn't understand ISO 8601

`date "2026-05-12"` returns 0 results or errors. AppleScript expects formats like `date "May 12, 2026"`. The plugin's `DateParser.normalizeToAppleScriptDate()` helper converts ISO/numeric dates for AppleScript fallback paths.

### 4. `tell calendar "X"` vs `events of calendar "X"` variable scoping

Inside `tell calendar "X"`, use `events whose uid is "..."` (implicitly targeting the told calendar). Outside a `tell calendar` block, in a `repeat with cal in calendars` / `tell cal` loop, use `events of cal whose uid is "..."`. Mixing these up produces "The variable cal is not defined" errors.

### 5. Empty string optional fields from AI

The AI model may pass `""` for optional string fields (e.g. `startDate`, `endDate`). Check `params.field?.trim() || undefined` instead of `params.field !== undefined` to avoid passing empty strings to date parsers.

### 6. NSDate creation from AppleScript dates

`NSDate's dateWithTimeInterval:0 sinceDate:(date "May 12, 2026")` doesn't work reliably. Use `NSDate's dateWithString:"2026-05-12 00:00:00 +0000"` (UTC ISO format) instead.

### 7. EKEvent properties require `valueForKey:`

In AppleScriptObjC, EKEvent objects are Objective-C objects, not native AppleScript objects. Access properties via `valueForKey:`: `(evt's valueForKey:"title") as string` instead of `summary of evt`. Key mapping: `title` (not `summary`), `eventIdentifier` (not `uid`), `isAllDay` (not `allday event`), `startDate`/`endDate`, `location`, `description`.

## Disconnect

`toby disconnect applecalendar` clears the integration flag from `config.json` (it does not remove calendar data).
