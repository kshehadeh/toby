# Toby Apple Calendar plugin

Installable integration plugin for local **Calendar.app** on macOS. Implements [plugin protocol v1](../../../docs/plugin-protocol.md) as a TypeScript bun-package that delegates all calendar operations to Toby.app's native API server.

## Build

From the repo root:

```bash
bun run build:plugin:applecalendar
```

The plugin directory is copied to `../../dist/toby-plugin-applecalendar` with production dependencies.

## Install (development)

```bash
toby plugins install ./dist/toby-plugin-applecalendar --link --force
toby plugins doctor
toby connect applecalendar
```

## Implementation

- **Architecture**: TypeScript bun-package plugin that forwards all tool executions to Toby.app's native API server via HTTP
- **Native operations**: Toby.app uses **EventKit** (`EKEventStore`) for calendar access, search, and CRUD
- **Auto-launch**: When Toby.app is not running, the plugin auto-launches it in the background and waits for the native server to become available

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
