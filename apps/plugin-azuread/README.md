# toby-plugin-azuread

Installable Azure AD integration for [Toby](../../README.md). Implements
[plugin protocol v1](../../docs/plugin-protocol.md) with full parity to the
former built-in module (OAuth PKCE, client credentials, Graph chat tools).

## Build

```bash
# From repo root
bun run build:plugin:azuread

# Or from this directory
bun run build
```

Output: `dist/toby-plugin-azuread`. Release installs copy it to `~/.toby/plugins/`.

## Local development

```bash
# From repo root
bun run build:plugin:azuread

# If you use `toby` on PATH (release binary or compiled dist/toby):
toby plugins install ./dist/toby-plugin-azuread --link --force

# If you use `bun run dev`, the CLI cwd is apps/cli — use this path instead:
bun run dev -- plugins install ../../dist/toby-plugin-azuread --link --force

toby plugins doctor
toby configure
toby connect azuread
```
