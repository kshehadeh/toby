# toby-plugin-slack

Installable Slack integration for [Toby](../../README.md). Implements
[plugin protocol v1](../../docs/plugin-protocol.md) with chat tools, OAuth/bot-token
auth, and Socket Mode inbound (`inbound run` NDJSON subcommand).

**CLI contract:** [`docs/plugin-protocol.md#cli-contract`](../../docs/plugin-protocol.md#cli-contract)

## Build

```bash
# From this directory
bun run build
```

Output: `dist/toby-plugin-slack`.

## Local development

```bash
bun run build
toby plugins install ./dist/toby-plugin-slack --link --force
toby plugins doctor
toby configure
toby connect slack
```

For daemon inbound, configure **bot token** (xoxb-...) and **app token** (xapp-..., Socket Mode) in addition to OAuth chat credentials.

## Capabilities

- **chat** — post, reply, search channels/users/messages
- **inbound** — @mentions, DMs, and thread follow-ups via Socket Mode
