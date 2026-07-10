---
sidebar_position: 7
title: Apple Calendar
---

# Apple Calendar

Connect Toby to **Calendar.app** on your Mac to search, create, and update events.

The Apple Calendar plugin ships with Toby.app under `~/.toby/plugins/`.

:::info[Platform]

**macOS only.** Calendar tools require Calendar.app on a Mac.

:::

## Prerequisites

- macOS with **Calendar.app** and at least one calendar (iCloud, Exchange, Google via CalDAV, etc.)
- **Toby.app** installed and launched (the plugin auto-launches it when not running)
- Calendar permission granted to **Toby.app** in System Settings → Privacy & Security → Calendars

## Configure

Open **Toby.app → Integrations → Apple Calendar**. Optional **Notes** are for your own reference only. Save.

## Connect

Click **Connect** on the Apple Calendar detail page. Toby runs a Calendar.app health check and stores a connected flag.

The plugin delegates all calendar operations to Toby.app's native API server,
which uses EventKit to access Calendar.app. When Toby.app is not running, the
plugin auto-launches it in the background. Calendar permission is granted to
Toby.app, not the plugin itself.

## Verify

Return to **Integrations** in the sidebar. Apple Calendar should show as connected. The first time you use calendar tools, macOS may prompt you to grant Calendar access to Toby.app.

## Disconnect

Open the Apple Calendar detail page and click **Disconnect**.

## Example chat prompts

- “What meetings do I have tomorrow between 9am and 5pm?”
- “Create a 30-minute focus block called Deep work tomorrow at 10am on my Work calendar.”

## Tips

- Use exact calendar names from your calendar list when filtering.
- Event UIDs are Calendar.app string identifiers returned by search or create tools.

## Related

- [Integrations overview](overview)
- [Apple Reminders](apple-reminders)
- [Apple Contacts](apple-contacts)
- [Toby.app](../toby-app)
- [Configure and connect](../getting-started/configure-and-status)
