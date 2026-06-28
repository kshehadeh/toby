---
sidebar_position: 7
title: Apple Calendar
---

# Apple Calendar

Connect Toby to **Calendar.app** on your Mac to search, create, and update events.

**CLI name:** `applecalendar`

The plugin ships in Toby release archives as `toby-plugin-applecalendar` under `~/.toby/plugins/`. For local development:

```bash
bun run build:plugin:applecalendar
toby plugins install ./dist/toby-plugin-applecalendar --link --force
```

:::info[Platform]

**macOS only.** On Linux or Windows you can configure the integration, but chat tools require Calendar.app on a Mac.

:::

## Prerequisites

- macOS with **Calendar.app** and at least one calendar (iCloud, Exchange, Google via CalDAV, etc.)
- **Toby.app** installed and launched (the plugin auto-launches it when not running)
- Calendar permission granted to **Toby.app** in System Settings → Privacy & Security → Calendars

## Configure

```bash
toby config
```

Go to **Integrations → Apple Calendar**. Optional **Notes** are for your own reference only. Save.

## Connect

```bash
toby connect applecalendar
```

Toby runs a Calendar.app health check and stores a connected flag.

The plugin delegates all calendar operations to Toby.app's native API server,
which uses EventKit to access Calendar.app. When Toby.app is not running, the
plugin auto-launches it in the background. Calendar permission is granted to
Toby.app, not the plugin itself.

## Verify

```bash
toby status integration -i applecalendar
```

## Disconnect

```bash
toby disconnect applecalendar
```

## Example chat prompts

- “What meetings do I have tomorrow between 9am and 5pm?”
- “Create a 30-minute focus block called Deep work tomorrow at 10am on my Work calendar.”

## Tips

- Use exact calendar names from `listCalendars` when filtering.
- Event UIDs are Calendar.app string identifiers returned by search or create tools.

## Related

- [Integrations overview](overview)
- [Toby.app](../toby-app)
- [Configure and connect](../getting-started/configure-and-status)
