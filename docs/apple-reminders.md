# Apple Reminders integration

First-party integration id: **`applereminders`**, shipped as the TypeScript bun-package plugin **`toby-plugin-applereminders`** ([`apps/plugin-applereminders/`](../apps/plugin-applereminders/)). Release archives and `install-toby.sh` install it under `~/.toby/plugins/`.

## Setup

- **macOS only.** The plugin delegates all reminder operations to **Toby.app's native API server**, which uses **EventKit** (`EKEventStore` and `EKReminder`) to drive Reminders.app on the local Mac. On Linux or Windows the plugin can be installed for tests but chat tools require Toby.app running on a Mac.
- No API keys are required.

1. Use a Mac with Reminders.app configured (at least one reminder list).
2. Launch **Toby.app** once so its native API server is available.
3. Run **`toby connect applereminders`** once. This stores a "connected" flag under `~/.toby/config.json` after a quick Reminders.app health check.
4. Grant Reminders access to Toby if macOS prompts. You can also grant it later in **System Settings → Privacy & Security → Reminders**.

## Chat tools

| Tool | Purpose |
| ---- | ------- |
| `listReminderLists` | List Reminders.app list names and colors; use exact names for the `list` filter. |
| `searchReminders` | Search reminders by query text, list name, completion state, due date range, completed date range, and limit. |
| `getReminder` | Fetch a single reminder by id. |
| `createReminder` | Create a reminder with title, optional notes, list, due date/time, priority, and URL. |
| `updateReminder` | Patch title, notes, list, due date/time, priority, or URL by id. |
| `completeReminder` | Mark a reminder complete or incomplete. |
| `deleteReminder` | Delete a reminder by id. |

Reminder ids are **Reminders.app string identifiers**, not numeric ids. Prefer ids returned from `searchReminders`, `getReminder`, or `createReminder`.

Priority uses EventKit values: `0` none, `1` high, `5` medium, and `9` low.

## Implementation notes

The plugin is a thin TypeScript protocol adapter that forwards all tool executions to Toby.app's native API server via HTTP (`/api/native/reminders/*` endpoints). The app's `NativeAppleRemindersHandler.swift` uses native **EventKit** for reminder list access, search, create, update, completion, and deletion.

Search defaults to incomplete reminders unless `completed` or completion-date filters are supplied. Due and completion date filters accept ISO 8601 strings and the same minimal natural-language date parsing used by the Apple Calendar native search path.

## Disconnect

`toby disconnect applereminders` clears the integration flag from `config.json` (it does not remove reminder data).
