---
sidebar_position: 1
title: Local APIs
---

# Local APIs

Toby exposes **two separate localhost HTTP APIs**. They are not interchangeable: each runs in a different process, uses a different port discovery model, and serves a different purpose.

| API | Hosted by | How to reach it | Purpose |
| --- | --------- | --------------- | ------- |
| **Server API** (daemon) | Local Toby background service | `http://127.0.0.1:7847` by default | Chat, sessions, configuration, memories, projects, recordings list/transcribe, schedules, integrations |
| **Native API** | Toby.app (macOS app) | Port written to `~/.toby/native-port` | TCC-gated macOS work: Calendar, Contacts, Reminders, Accessibility, mic/system audio capture |

This section documents **both** local HTTP APIs as separate references. Product usage of the Mac app is covered in [Toby.app](../toby-app); architecture context is in [Architecture](../architecture/overview).

## Server API at a glance

The local service (daemon) is the same runtime Toby.app, scheduled jobs, and inbound chat (for example Slack mentions) share. Toby.app starts it when needed and talks to it over HTTP and server-sent events (SSE).

**Access model**

- Base URL: `http://127.0.0.1:<port>` — default port **7847**
- Binding: **localhost only** — do not expose this port to other machines
- Auth: **none** — the API assumes local trust on your Mac
- Encoding: JSON for most routes; **SSE** (`text/event-stream`) for chat turns
- Errors: non-2xx responses use `{ "error": string }`
- Unknown `/api/*` paths return `404`

Configure port or disable the HTTP server in `~/.toby/config.json`:

```json
{
  "web": {
    "enabled": true,
    "port": 7847
  }
}
```

## Who uses the Server API

| Client | Typical use |
| ------ | ----------- |
| **Toby.app** | Primary UI: sessions, streaming turns, settings, recordings browser, projects, memories |
| **Daemon / schedules** | Recurring prompts and background work on the same harness |
| **Inbound chat** | External messages (for example Slack) enter the same chat pipeline |
| **Local automation** | Scripts or tools that call `http://127.0.0.1:7847` while Toby is running |

## Native API at a glance

Toby.app hosts a **second** localhost server for operations that must run under the app’s bundle identity (Calendar, Contacts, Reminders, microphone, system audio, Accessibility, and related macOS controls).

**Access model**

- Port: **ephemeral** — written to `~/.toby/native-port` when Toby.app is running
- Base URL: `http://127.0.0.1:<port from native-port>`
- Binding: localhost only; **no auth**
- Paths: all under `/api/native/…`
- Response envelope: `{ "ok": true, "data": … }` or `{ "ok": false, "error": "…", "needsPermission": true }`
- Clients (plugins, listen) often **auto-launch** Toby.app if health fails

**Audio capture** goes through the Native API; **listing, deleting, and transcribing** saved recordings use the **Server API** (`/api/listen/…`).

## Next

- **[Server API reference](./server-api)** — daemon endpoints, request/response shapes, SSE chat turns
- **[Native API reference](./native-api)** — Toby.app `/api/native/*` endpoints for TCC-gated work
