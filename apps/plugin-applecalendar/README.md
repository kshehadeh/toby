# Toby Apple Calendar plugin

Installable integration plugin for local **Calendar.app** on macOS. Implements [plugin protocol v1](../../../docs/plugin-protocol.md).

## Build

From the repo root:

```bash
bun run build:plugin:applecalendar
```

Or from this directory:

```bash
swift build -c release
```

The binary is written to `../../dist/toby-plugin-applecalendar`.

## Install (development)

```bash
toby plugins install ./dist/toby-plugin-applecalendar --link --force
toby plugins doctor
toby connect applecalendar
```

## Implementation

- **Search / list / CRUD**: native **EventKit** (`EKEventStore`) where possible
- **Fallback**: Calendar.app AppleScript for operations EventKit cannot complete (see `CalendarClient.swift`)

## Tools

| Tool | Purpose |
| ---- | ------- |
| `listCalendars` | List calendar names and colors |
| `searchCalendarEvents` | Search by query, calendar, date range |
| `getCalendarEvent` | Full event details including attendees |
| `createCalendarEvent` | Create event; returns uid |
| `updateCalendarEvent` | Patch event by uid |
| `deleteCalendarEvent` | Delete event by uid |

See [`docs/apple-calendar.md`](../../../docs/apple-calendar.md) for setup and permissions.
