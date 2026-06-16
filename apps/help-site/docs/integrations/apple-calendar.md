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
- Calendar permission for **Toby.app** when the native app is available, or permission for your terminal/plugin fallback when it is not

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

When Toby.app is running, the plugin routes Calendar/EventKit calls through the
app's native API server so macOS permission is granted to a stable app bundle.
When Toby.app is unavailable, the plugin falls back to its command-line native
path and may ask for terminal or automation permissions.

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
- Keep Toby.app running if you want Calendar permission prompts and operations to be associated with the Toby app bundle.

## Related

- [Integrations overview](overview)
- [Toby.app](../toby-app)
- [Configure and connect](../getting-started/configure-and-status)
