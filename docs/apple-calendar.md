# Apple Calendar integration

First-party integration id: **`applecalendar`**, shipped as the TypeScript bun-package plugin **`toby-plugin-applecalendar`** ([`apps/plugin-applecalendar/`](../apps/plugin-applecalendar/)). Release archives and `install-toby.sh` install it under `~/.toby/plugins/`.

## Platform

- **macOS only.** The plugin delegates all calendar operations to **Toby.app's native API server**, which uses **EventKit** (`EKEventStore`) to drive Calendar.app on the local Mac. On Linux or Windows the plugin can be installed for tests but chat tools require Toby.app running on a Mac.

## Setup

1. Use a Mac with Calendar.app configured (at least one calendar).
2. Install and launch **Toby.app** — the plugin auto-launches it in the background when it is not running.
3. Run **`toby connect applecalendar`** once. This stores a "connected" flag under `~/.toby/config.json` after a quick Calendar.app health check.
4. On first real automation, macOS may prompt to allow **Calendar** access for Toby.app. Approve it in **System Settings → Privacy & Security → Calendars**.

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

## Architecture

The plugin is a thin TypeScript protocol adapter that forwards all tool executions to Toby.app's native API server via HTTP (`/api/native/calendar/*` endpoints). The app's `NativeCalendarHandler.swift` uses native **EventKit** (`EKEventStore`) for all calendar operations: search, list, get, create, update, and delete.

When Toby.app is not running, the plugin auto-launches it in the background (`open -g`) and waits for the native server to become available before forwarding requests. Calendar access permissions (TCC) are granted to Toby.app, not the plugin itself.

### EventKit search

Event search uses `EKEventStore.predicateForEvents(withStart:end:calendars:)` against the local EventKit database. This works correctly for all calendar types (local, iCloud, Exchange) and returns results in under a second.

## Disconnect

`toby disconnect applecalendar` clears the integration flag from `config.json` (it does not remove calendar data).
