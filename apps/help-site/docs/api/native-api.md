---
sidebar_position: 3
title: Native API
---

# Native API

The **Native API** is a localhost HTTP server hosted by **Toby.app** (the macOS app). It exists for operations that must run under Toby.app’s signed bundle identity — macOS TCC permissions, EventKit, Contacts, Location Services, Accessibility, microphone/system audio capture, and related system controls.

This page is the endpoint reference. For how this differs from the daemon **Server API**, see [Local APIs](./overview). Product surfaces of the Mac app are in [Toby.app](../toby-app).

:::note Server API is separate
Chat, sessions, configure, memories, projects, and recording **list/transcribe** use the [Server API](./server-api) on port **7847**. Do not call those routes on the Native API host.
:::

## Why this API exists

macOS ties permission grants (Calendar, Contacts, Reminders, Location, Microphone, Screen Recording / system audio, Accessibility, Notifications) to the **calling binary’s identity**. Raw CLI or plugin binaries show confusing names in System Settings, or fail EventKit/XPC checks.

By routing through Toby.app:

- Users grant permissions once to a clearly named app
- Plugins stay TypeScript and call HTTP instead of shipping native code
- Audio capture stays owned by the app process (AVFoundation / ScreenCaptureKit)

## Access model

| Item | Detail |
| ---- | ------ |
| Host | Toby.app process (must be running, or auto-launched by clients) |
| Port | **Ephemeral** — written to `~/.toby/native-port` as plain text (e.g. `53142`) |
| Base URL | `http://127.0.0.1:<port from native-port>` |
| Binding | Localhost only |
| Auth | None (local trust) — do not expose this port |
| Encoding | JSON request bodies; JSON responses |
| Response envelope | Success: `{"ok":true,"data":{...}}` · Failure: `{"ok":false,"error":"..."}` (often with `"needsPermission":true`) |

### Discovery

1. Ensure Toby.app is installed and can be launched.
2. Read the port:

   ```bash
   cat ~/.toby/native-port
   ```

3. Confirm liveness:

   ```bash
   curl -s "http://127.0.0.1:$(cat ~/.toby/native-port)/api/native/health"
   ```

Example health response:

```json
{ "ok": true, "service": "toby-native" }
```

First-party plugins (Apple Calendar, Contacts, Reminders, macOS) and the listen/audio path auto-launch Toby.app if the health check fails, then wait for the port file and retry.

### Permissions

When access is denied, handlers typically return:

```json
{
  "ok": false,
  "error": "Calendar access denied.",
  "needsPermission": true
}
```

Grant the relevant permission to **Toby.app** in **System Settings → Privacy & Security** (Calendar, Contacts, Reminders, Location Services, Microphone, Screen & System Audio Recording, Accessibility, Notifications, etc.). You can also use Toby.app → **File → Permissions…**.

## Who uses the Native API

| Client | Typical use |
| ------ | ----------- |
| **Toby.app (self)** | Loopback for audio capture so AVFoundation / ScreenCaptureKit stay in-process |
| **toby-plugin-applecalendar** | EventKit calendar tools |
| **toby-plugin-applecontacts** | Contacts.framework search / detail |
| **toby-plugin-applereminders** | EventKit reminder tools |
| **toby-plugin-macos** | Wi‑Fi, battery, audio devices, windows, clipboard, shortcuts, … |
| **CLI / core listen path** | Start/stop/combine recording via `/api/native/audio/*` |
| **Core `getMyLocation` tool** | Current location via `/api/native/location/*` |

After capture, **listing, deleting, and transcribing** recordings return to the [Server API](./server-api) (`/api/listen/…`).

## Endpoint index

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/native/health` | Liveness check |
| `POST` | `/api/native/calendar/request-access` | Prompt Calendar permission |
| `POST` | `/api/native/calendar/list` | List calendars |
| `POST` | `/api/native/calendar/search` | Search events |
| `POST` | `/api/native/calendar/get` | Get event by uid |
| `POST` | `/api/native/calendar/create` | Create event |
| `POST` | `/api/native/calendar/update` | Update event |
| `POST` | `/api/native/calendar/delete` | Delete event |
| `POST` | `/api/native/contacts/request-access` | Prompt Contacts permission |
| `POST` | `/api/native/contacts/search` | Search contacts |
| `POST` | `/api/native/contacts/get` | Get contact by identifier |
| `POST` | `/api/native/location/status` | Location authorization status |
| `POST` | `/api/native/location/request-access` | Prompt Location Services |
| `POST` | `/api/native/location/current` | One-shot current location |
| `GET` | `/api/native/icloud/status` | iCloud Drive availability and vault path |
| `POST` | `/api/native/icloud/ensure` | Download a dataless vault file if needed |
| `POST` | `/api/native/icloud/read` | Coordinated read of the encrypted vault |
| `POST` | `/api/native/icloud/write` | Coordinated write of the encrypted vault |
| `GET` | `/api/native/icloud/history` | History filenames |
| `POST` | `/api/native/icloud/delete` | Delete the iCloud vault folder |
| `POST` | `/api/native/reminders/request-access` | Prompt Reminders permission |
| `POST` | `/api/native/reminders/lists` | List reminder lists |
| `POST` | `/api/native/reminders/search` | Search reminders |
| `POST` | `/api/native/reminders/get` | Get reminder by id |
| `POST` | `/api/native/reminders/create` | Create reminder |
| `POST` | `/api/native/reminders/update` | Update reminder |
| `POST` | `/api/native/reminders/complete` | Complete / uncomplete |
| `POST` | `/api/native/reminders/delete` | Delete reminder |
| `POST` | `/api/native/schedules/completion-notification` | Schedule-run completion notification |
| `GET` | `/api/native/macos/accessibility-status` | Accessibility grant status |
| `POST` | `/api/native/macos/wifi-status` | Wi‑Fi interface status |
| `POST` | `/api/native/macos/wifi-scan` | Scan networks |
| `POST` | `/api/native/macos/wifi-set-power` | Enable/disable Wi‑Fi |
| `POST` | `/api/native/macos/battery-status` | Battery snapshot |
| `POST` | `/api/native/macos/audio-list-outputs` | List audio outputs |
| `POST` | `/api/native/macos/audio-switch-output` | Switch default output |
| `POST` | `/api/native/macos/audio-volume` | Current volume |
| `POST` | `/api/native/macos/audio-set-volume` | Set volume 0–100 |
| `POST` | `/api/native/macos/audio-set-mute` | Mute/unmute |
| `POST` | `/api/native/macos/bluetooth-status` | Bluetooth status |
| `POST` | `/api/native/macos/bluetooth-set-power` | Enable/disable Bluetooth |
| `POST` | `/api/native/macos/low-power-status` | Low Power Mode status |
| `POST` | `/api/native/macos/low-power-set` | Set Low Power Mode |
| `POST` | `/api/native/macos/shortcuts-run` | Run a Shortcuts shortcut |
| `POST` | `/api/native/macos/display-brightness` | Current brightness |
| `POST` | `/api/native/macos/display-set-brightness` | Set brightness 0–100 |
| `POST` | `/api/native/macos/clipboard-read` | Read clipboard text |
| `POST` | `/api/native/macos/clipboard-write` | Write clipboard text |
| `POST` | `/api/native/macos/system-info` | Machine / OS info |
| `POST` | `/api/native/macos/notification-show` | Show a user notification |
| `POST` | `/api/native/macos/minimize-all` | Minimize all windows (Accessibility) |
| `POST` | `/api/native/macos/unminimize-all` | Unminimize all windows |
| `POST` | `/api/native/macos/minimize-app` | Minimize one app’s windows |
| `POST` | `/api/native/macos/unminimize-app` | Unminimize one app’s windows |
| `POST` | `/api/native/macos/windows-hide-all` | Hide all apps |
| `POST` | `/api/native/macos/windows-show-all` | Show all apps |
| `POST` | `/api/native/macos/window-hide-app` | Hide one app |
| `GET` | `/api/native/audio/status` | Native recording state |
| `POST` | `/api/native/audio/start` | Start mic / system capture |
| `POST` | `/api/native/audio/stop` | Stop and save or discard |
| `POST` | `/api/native/audio/combine` | Combine mic + system WAVs to `combined.m4a` |

Most operation endpoints accept **POST** with a JSON body (even when empty). Health and a few status routes use **GET**.

## Health

### `GET /api/native/health`

```json
{ "ok": true, "service": "toby-native" }
```

Use this before other calls. Unknown paths return `404` with `{"ok":false,"error":"…"}`.

## Calendar (EventKit)

Requires **Calendar** access for Toby.app.

### `POST /api/native/calendar/request-access`

Prompts if needed.

Success: `{ "ok": true, "data": { "prompted": true, "granted": true } }`  
Denied: `ok: false`, `needsPermission: true`.

### `POST /api/native/calendar/list`

```json
{
  "ok": true,
  "data": {
    "calendars": [{ "name": "Home", "color": "…" }],
    "count": 1
  }
}
```

### `POST /api/native/calendar/search`

```ts
type SearchEventsBody = {
  query?: string;
  calendar?: string; // calendar title filter
  dateFrom?: string; // ISO-ish start bound
  dateTo?: string;
  limit?: number; // default 30, max 200
};
```

Returns `{ events, count }` under `data`.

### `POST /api/native/calendar/get`

```json
{ "uid": "…", "calendar": "optional title check" }
```

### `POST /api/native/calendar/create`

Required: `summary`, `startDate`, `endDate` (ISO 8601, e.g. `2026-01-15T09:00:00`).

Optional: `calendar`, `allDay`, `location`, `description`.

```json
{ "ok": true, "data": { "uid": "…", "summary": "…" } }
```

### `POST /api/native/calendar/update`

Required: `uid`. Optional field updates: `summary`, `startDate`, `endDate`, `location`, `description`, `allDay`, `calendar` (match check).

### `POST /api/native/calendar/delete`

Required: `uid`.

## Contacts

Requires **Contacts** access for Toby.app.

### `POST /api/native/contacts/request-access`

Same pattern as calendar request-access.

### `POST /api/native/contacts/search`

```ts
type SearchContactsBody = {
  query?: string; // empty = first N contacts
  limit?: number; // default 25, max 100
};
```

Contact summaries include `identifier`, `displayName`, names, organization, emails, phones.

### `POST /api/native/contacts/get`

```json
{ "identifier": "…" }
```

Returns full contact detail under `data`.

## Location (CoreLocation)

Requires **Location Services** access for Toby.app. Used by the global
`getMyLocation` chat tool. You can also grant access from Toby.app’s
**Permissions** window (Location Access).

### `POST /api/native/location/status`

Returns authorization status without prompting:

```json
{
  "ok": true,
  "data": {
    "authorizationStatus": "authorizedWhenInUse",
    "granted": true,
    "servicesEnabled": true
  }
}
```

### `POST /api/native/location/request-access`

Prompts for Location Services when status is not yet determined.

### `POST /api/native/location/current`

One-shot location fix. Prompts for permission when needed.

```ts
type CurrentLocationBody = {
  accuracy?: "best" | "hundredMeters" | "kilometer"; // default hundredMeters
  reverseGeocode?: boolean; // default true
};
```

Success `data` includes `latitude`, `longitude`, `horizontalAccuracyMeters`,
`timestamp`, and optional `place` (MapKit reverse-geocoded fields such as
`locality`, `administrativeArea`, `country`, `displayName`).

## Reminders (EventKit)

Requires **Reminders** access for Toby.app.

### `POST /api/native/reminders/request-access`

### `POST /api/native/reminders/lists`

```json
{
  "ok": true,
  "data": {
    "lists": [{ "name": "Reminders", "color": "…" }],
    "count": 1
  }
}
```

### `POST /api/native/reminders/search`

```ts
type SearchRemindersBody = {
  query?: string;
  list?: string;
  completed?: boolean; // default false unless completedFrom/To set
  completedFrom?: string;
  completedTo?: string;
  dueFrom?: string;
  dueTo?: string;
  limit?: number; // default 30, max 200
};
```

### `POST /api/native/reminders/get`

Required: `id`. Optional: `list` (title match check).

### `POST /api/native/reminders/create`

Required: `title`. Optional: `list`, `notes`, `dueDate` (ISO 8601), `priority` (`0`, `1`, `5`, or `9`), `url`.

### `POST /api/native/reminders/update`

Required: `id`. Optional: `title`, `notes`, `list`, `dueDate` (empty string clears), `priority`, `url`.

### `POST /api/native/reminders/complete`

Required: `id`. Optional: `completed` (default `true`).

### `POST /api/native/reminders/delete`

Required: `id`.

## Audio capture

Used by Toby.app UI and the listen / CLI capture path. Microphone and Screen/System Audio permissions belong to **Toby.app**.

### `GET /api/native/audio/status`

Returns recording state under `data`:

- `idle` — nothing in progress
- `recording` — microphone / system audio is being captured
- `stopping` — capture has stopped; combine / export is still running (long recordings)

Also includes a message and session/options while `recording` or `stopping`.

### `POST /api/native/audio/start`

```json
{ "mic": true, "system": true }
```

Defaults: both sources `true`. At least one source must be selected. Fails if already recording.

### `POST /api/native/audio/stop`

```json
{ "action": "save" }
```

or

```json
{ "action": "discard" }
```

Default is save. Stop returns after capture ends **and** final audio is written
(combine / `combined.m4a` export). That finalize step can take minutes for a
long dual-source recording; clients should not use a short HTTP timeout.
`GET /api/native/audio/status` reports `stopping` while finalize runs.

On save, returns `id`, `outputDir`, `files` (paths), and optional `errors`. Files land under Toby’s listen storage; use the [Server API](./server-api#listen-and-recordings) to list, patch, delete, or transcribe.

### `POST /api/native/audio/combine`

```json
{
  "outDir": "/path/to/recording-dir",
  "mic": "/path/to/mic.wav",
  "system": "/path/to/system.wav"
}
```

`outDir` is required. Optional `mic` / `system` paths. Returns `{ "combined": "…/combined.m4a" }` on success.

## macOS system controls

These endpoints back **toby-plugin-macos**. Window minimize/unminimize paths need **Accessibility** for Toby.app. Notification show may prompt for **Notifications**.

### Status / read (body often empty)

| Path | Notes |
| --- | --- |
| `GET /api/native/macos/accessibility-status` | Whether Accessibility is granted |
| `POST /api/native/macos/wifi-status` | Interface power / association |
| `POST /api/native/macos/wifi-scan` | Nearby networks |
| `POST /api/native/macos/battery-status` | Charge %, power source |
| `POST /api/native/macos/audio-list-outputs` | Output devices |
| `POST /api/native/macos/audio-volume` | Volume level |
| `POST /api/native/macos/bluetooth-status` | Power / connectivity |
| `POST /api/native/macos/low-power-status` | Low Power Mode |
| `POST /api/native/macos/display-brightness` | Brightness |
| `POST /api/native/macos/clipboard-read` | Clipboard string |
| `POST /api/native/macos/system-info` | Hostname, machine, OS version, Apple Silicon flag |

### Mutations (JSON body)

| Path | Body fields |
| --- | --- |
| `/api/native/macos/wifi-set-power` | `enabled` (boolean) |
| `/api/native/macos/audio-switch-output` | `deviceSubstring` (string) |
| `/api/native/macos/audio-set-volume` | `level` (0–100) |
| `/api/native/macos/audio-set-mute` | `muted` (boolean) |
| `/api/native/macos/bluetooth-set-power` | `enabled` (boolean) |
| `/api/native/macos/low-power-set` | `enabled` (boolean) |
| `/api/native/macos/shortcuts-run` | `name` (shortcut name) |
| `/api/native/macos/display-set-brightness` | `level` (0–100) |
| `/api/native/macos/clipboard-write` | `text` (non-empty string) |
| `/api/native/macos/notification-show` | `title`, `description` (required); `ctas` (string array, max 4) |
| `/api/native/macos/minimize-app` | `name` (app name) |
| `/api/native/macos/unminimize-app` | `name` |
| `/api/native/macos/window-hide-app` | `appName` |

### Windows (Accessibility)

No body required for:

- `POST /api/native/macos/minimize-all`
- `POST /api/native/macos/unminimize-all`
- `POST /api/native/macos/windows-hide-all`
- `POST /api/native/macos/windows-show-all`

## Schedule completion notifications

### `POST /api/native/schedules/completion-notification`

Used when a scheduled job finishes and Toby should surface a local notification.

Typical body fields: `scheduleId` (required), optional `scheduleName`, `runId`, `status`, `error`.

## Example: call from the shell

```bash
PORT=$(cat ~/.toby/native-port)

curl -s "http://127.0.0.1:${PORT}/api/native/health"

curl -s -X POST "http://127.0.0.1:${PORT}/api/native/calendar/list" \
  -H "Content-Type: application/json" \
  -d '{}'

curl -s -X POST "http://127.0.0.1:${PORT}/api/native/audio/start" \
  -H "Content-Type: application/json" \
  -d '{"mic":true,"system":true}'
```

## Plugin integration pattern

First-party plugins use a shared client approach:

1. Read `~/.toby/native-port`
2. `GET /api/native/health`
3. If down, launch Toby.app (`open -g …`) and retry
4. `POST` the operation path with a JSON body
5. Interpret `{ ok, data, error, needsPermission }`

Optional env: `TOBY_APP_PATH` to point at a specific `.app` bundle when auto-launching.

## See also

- [Local APIs](./overview) — Server API vs Native API
- [Server API](./server-api) — daemon HTTP (chat, sessions, listen list/transcribe)
- [Toby.app](../toby-app) — product UI and roles
- [Architecture](../architecture/overview) — module boundaries
- Integrations: [macOS](../integrations/macos), [Apple Calendar](../integrations/apple-calendar), [Apple Reminders](../integrations/apple-reminders), [Apple Contacts](../integrations/apple-contacts)
- Contributor notes: [native-helpers.md](https://github.com/kshehadeh/toby/blob/main/docs/native-helpers.md)
