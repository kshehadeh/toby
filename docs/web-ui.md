# Toby Web UI

When the Toby daemon is running, a local web server exposes a React UI for browsing sessions and memories and viewing/editing non-secret configuration.

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
| Configuration | Full tree (same sections as `toby configure`) | Non-secret fields only |

Secrets (API tokens, OAuth credentials) are shown as **Configured / Not set** — never exposed or writable via the web API.

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

The header **Restart daemon** button runs `toby daemon restart` (stop then start) and refreshes the UI when the daemon is back.

The header also shows **chat inbound** status (configured provider and live connection state from the daemon). Hover the badge for details.

## Release

Release builds copy `apps/web/dist` to `dist/web/` alongside the compiled `toby` binary. Installers and upgrades place that folder at **`web/` next to the `toby` binary** (e.g. `~/.local/bin/web` when `toby` is on your PATH).
