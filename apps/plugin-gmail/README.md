# toby-plugin-gmail

Installable Gmail integration for [Toby](../../README.md). Implements
[plugin protocol v1](../../docs/plugin-protocol.md) with full parity to the
former built-in module (OAuth, inbox tools, chat).

**CLI contract:** [`docs/plugin-protocol.md#cli-contract`](../../docs/plugin-protocol.md#cli-contract) — argv subcommands, stdin/stdout JSON, exit codes.

## Build

```bash
# From repo root
bun run build:plugin:gmail

# Or from this directory
bun run build
```

Output: `dist/toby-plugin-gmail`. Release installs copy it to `~/.toby/plugins/`.

## Local development

```bash
# From repo root
bun run build:plugin:gmail

toby plugins install ./dist/toby-plugin-gmail --link --force

toby plugins doctor
toby configure
toby connect gmail
```
