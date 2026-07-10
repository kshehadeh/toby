---
sidebar_position: 8
title: Apple Reminders
---

# Apple Reminders

Connect Toby to **Reminders.app** on your Mac to search, create, update, complete, and delete reminders.

The Apple Reminders plugin ships with Toby.app under `~/.toby/plugins/`.

:::info[Platform]

**macOS only.** Reminder tools require Reminders.app on a Mac.

:::

## Prerequisites

- macOS with **Reminders.app** and at least one reminder list (iCloud or local)
- **Toby.app** installed and launched (the plugin auto-launches it when not running)
- Reminders permission granted to **Toby.app** in System Settings → Privacy & Security → Reminders

## Configure

Open **Toby.app → Integrations → Apple Reminders**. Optional **Notes** are for your own reference only. Save.

## Connect

Click **Connect** on the Apple Reminders detail page. Toby runs a Reminders.app health check and stores a connected flag.

The plugin delegates all reminder operations to Toby.app's native API server,
which uses **EventKit** (`EKEventStore` / `EKReminder`). When Toby.app is not
running, the plugin auto-launches it in the background. Reminders permission is
granted to Toby.app, not the plugin itself.

No API keys are required.

## Verify

Return to **Integrations** in the sidebar. Apple Reminders should show as connected. The first time you use reminder tools, macOS may prompt you to grant Reminders access to Toby.app.

If permission was denied, enable it in **System Settings → Privacy & Security → Reminders**, then connect again.

## Disconnect

Open the Apple Reminders detail page and click **Disconnect**. This clears Toby's connection flag; it does not remove reminder data from Reminders.app.

## What you can do in chat

| Capability | Examples |
| ---------- | -------- |
| Lists | List reminder list names and colors |
| Search | Find by text, list, incomplete/completed, due or completion date range |
| Read | Full details for one reminder by id |
| Create | Title, optional notes, list, due date, priority, URL |
| Update | Patch title, notes, list, due date, priority, URL |
| Complete | Mark complete or incomplete |
| Delete | Remove a reminder by id |

Reminder **ids** are Reminders.app string identifiers (not numeric). Prefer ids returned from search or create.

**Priority** uses EventKit values: `0` none, `1` high, `5` medium, `9` low.

Search defaults to **incomplete** reminders unless you ask for completed items or supply completion-date filters.

## Example chat prompts

- “What reminders do I have due this week?”
- “Add a reminder: Call the dentist next Tuesday at 10am on my Personal list.”
- “Mark ‘Submit expense report’ as done.”
- “List my incomplete reminders on Work.”

## Tips

- Use **exact list names** from your list when filtering create/search.
- Due and completion filters accept ISO 8601 or simple natural-language dates.
- Apple Reminders is a **Task List Provider**. If you also use Todoist, set a default under **Settings → Default Providers** so schedules and multi-integration chat prefer the right one.

## Related

- [Integrations overview](overview)
- [Todoist](todoist) — another task provider
- [Apple Calendar](apple-calendar)
- [Apple Contacts](apple-contacts)
- [Native API](../api/native-api) — `/api/native/reminders/*`
- [Toby.app](../toby-app)
- [Configure and connect](../getting-started/configure-and-status)
