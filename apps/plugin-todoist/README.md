# Toby Todoist plugin

Installable integration plugin for [Todoist](https://todoist.com) task management.

## Build

From the repo root:

```bash
bun run build:plugin:todoist
```

Or from this directory:

```bash
bun run build
```

Output: `dist/toby-plugin-todoist`

## Install (development)

```bash
toby plugins install ./dist/toby-plugin-todoist --link --force
toby plugins doctor
```

## Configure

1. Copy your personal API token from Todoist → Settings → Integrations → Developer.
2. Run `toby configure` and set **Todoist API Key**.
3. Optionally run `toby connect todoist` to mark the integration connected.

Chat works with an API key alone (connect is optional).

## Protocol

Implements Toby plugin protocol v1. See [`docs/plugin-protocol.md`](../../docs/plugin-protocol.md).
