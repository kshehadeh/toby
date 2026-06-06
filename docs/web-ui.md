# Toby Web UI

When the Toby daemon is running, a local web server exposes a React UI for browsing sessions and memories and viewing/editing non-secret configuration.

## Opening the web UI (`/web`)

From a chat session, run the **`/web`** slash command. It:

1. Starts the daemon if it is not already running (equivalent to `toby daemon start`).
2. Opens the web UI (`http://127.0.0.1:<port>`) in your default browser.

If the daemon is already running, `/web` just opens the browser. If the web server is disabled (`web.enabled: false`), `/web` reports that and does nothing else. When a browser cannot be opened automatically (for example over SSH), `/web` prints the URL to visit manually.

You can also reach the same UI without chat: start the daemon (`toby daemon start`) and open `http://127.0.0.1:7847`.

## Access

- **URL:** `http://127.0.0.1:7847` (default port)
- **Binding:** localhost only (`127.0.0.1`) — not accessible from other machines
- **Auth:** none (local trust model)

Configure port or disable the server in `~/.toby/config.json`:

```json
{
  "web": {
    "enabled": true,
    "port": 7847
  }
}
```

## What you can do

| Area | Read | Edit |
|------|------|------|
| Sessions | Browse list and transcript | No |
| Memories | Browse and search | No |
| Configuration | Full tree (same sections as `toby configure`) | Yes, including secrets |

Secret fields (API tokens, keys) are **write-only**: their saved values are never sent to the browser (the API returns a redacted `••••••` placeholder), but they can be set or replaced from the web UI via password inputs. Leaving a secret field blank keeps the existing value unchanged.

## Development

1. Start the daemon from source: `bun run --cwd apps/cli dev daemon run` (or `dev daemon start` for background)
2. Build the UI once: `bun run --cwd apps/web build`
3. Open `http://127.0.0.1:7847`

After changing `@toby/core` (including web API routes), restart the daemon so it picks up the new code:

```bash
bun run --cwd apps/cli dev daemon restart
```

If you use a compiled `toby` binary instead, rebuild it (`bun run build:executable`) and restart the daemon before testing API changes.

For UI development with hot reload:

```bash
bun run --cwd apps/cli dev daemon run   # terminal 1
bun run dev:web                         # terminal 2 — proxies /api to :7847
```

From chat, **`/web`** starts the daemon if needed and opens the web UI in your browser.

The header shows a **daemon status badge**. Clicking it opens a popover with the daemon process details (PID, uptime, schedule poll interval, web port, log path) and buttons to **Restart** or **Stop** the daemon. Restart refreshes the UI once the daemon is back; stopping the daemon also stops the web server, so the UI goes offline.

The header also shows **chat inbound** status (configured provider and live connection state from the daemon). Hover the badge for details.

## Release

Release builds copy `apps/web/dist` to `dist/web/` alongside the compiled `toby` binary. Installers and upgrades place that folder at **`web/` next to the `toby` binary** (e.g. `~/.local/bin/web` when `toby` is on your PATH).
