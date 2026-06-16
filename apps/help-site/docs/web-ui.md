---
sidebar_position: 10
title: Web UI
---

# Web UI

Toby includes a local **web UI** for browsing your sessions and memories and for viewing and editing your configuration in a browser. It is served by the background **daemon** and runs entirely on your machine.

The web UI is one of Toby's local app surfaces. It calls the same daemon
localhost API that powers Toby.app, while the CLI can run the core harness
directly and start the daemon when a server-backed surface is needed.

## Open it with `/web`

The quickest way to open the web UI is the **`/web`** slash command from a chat session:

```text
/web
```

This:

1. Starts the daemon if it is not already running.
2. Opens the web UI in your default browser.

If the daemon is already running, `/web` just opens the browser. If a browser cannot be opened automatically (for example over SSH), Toby prints the URL so you can open it manually.

You can also open it without chat by starting the daemon and visiting the URL directly:

```bash
toby daemon start
# then open http://127.0.0.1:7847
```

## Access and privacy

- **URL:** `http://127.0.0.1:7847` (default port)
- **Local only:** the server binds to `127.0.0.1`, so it is not reachable from other machines.
- **No login:** access relies on local trust — anyone using your computer can open it.

Change the port or turn the web UI off in `~/.toby/config.json`:

```json
{
  "web": {
    "enabled": true,
    "port": 7847
  }
}
```

If `web.enabled` is `false`, the `/web` command reports that the UI is disabled.

## What you can do

| Area | What it shows | Editable |
| ---- | ------------- | -------- |
| Sessions | Past chat sessions and their transcripts | No |
| Memories | Stored memories, with search | No |
| Configuration | The same settings tree as `toby config` | Yes |

Editing configuration in the browser saves to the same files as the CLI (`~/.toby/config.json` and `~/.toby/credentials.json`).

**Secrets** (API tokens and keys) are handled safely: their saved values are never shown in the browser. A configured secret appears as a password field labelled *Configured* — type a new value to replace it, or leave it blank to keep the current one.

## Daemon controls

The header shows a **daemon status badge**. Click it to open a panel with the daemon's process details (PID, uptime, schedule interval, web port, and log location) and buttons to **Restart** or **Stop** the daemon.

Stopping the daemon also stops the web server, so the page goes offline until you start the daemon again (`toby daemon start` or `/web`).

A second badge shows **chat inbound** status — the configured provider and whether it is currently connected. Hover it for details.

## Related

- [Toby.app](./toby-app)
- [Architecture](./architecture/overview)
- [Configure & connect](./getting-started/configure-and-status)
- [Schedules](./schedules) and the daemon
- [Memories](./memories)
