# Toby Apple Reminders plugin

Installable integration plugin for local **Reminders.app** on macOS. Implements [plugin protocol v1](../../../docs/plugin-protocol.md) as a TypeScript bun-package that delegates all reminder operations to Toby.app's native API server.

## Build

From the repo root:

```bash
bun run build:plugin:applereminders
```

The plugin directory is copied to `../../dist/toby-plugin-applereminders` with production dependencies.

## Install (development)

```bash
toby plugins install ./dist/toby-plugin-applereminders --link --force
toby plugins doctor
toby connect applereminders
```

## Implementation

- **Architecture**: TypeScript bun-package plugin that forwards all tool executions to Toby.app's native API server via HTTP
- **Native operations**: Toby.app uses **EventKit** (`EKEventStore` and `EKReminder`) for Reminders access, search, and CRUD
- **Auto-launch**: When Toby.app is not running, the plugin auto-launches it in the background and waits for the native server to become available

## Tools

| Tool | Purpose |
| ---- | ------- |
| `listReminderLists` | List reminder list names and colors |
| `searchReminders` | Search by query, list, completion state, due range, completed range |
| `getReminder` | Full reminder details |
| `createReminder` | Create reminder; returns id |
| `updateReminder` | Patch reminder by id |
| `completeReminder` | Mark reminder complete or incomplete |
| `deleteReminder` | Delete reminder by id |

See [`docs/apple-reminders.md`](../../../docs/apple-reminders.md) for setup and permissions.
