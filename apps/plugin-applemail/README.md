# toby-plugin-applemail

Swift installable Toby plugin for local **Mail.app** automation on macOS. Implements
[plugin protocol v1](../../docs/plugin-protocol.md).

**CLI contract:** [`docs/plugin-protocol.md#cli-contract`](../../docs/plugin-protocol.md#cli-contract) — argv subcommands, stdin/stdout JSON, exit codes.

## Build

From repo root:

```bash
bun run build:plugin:applemail
```

Or from this directory:

```bash
swift build -c release
```

Output: `dist/toby-plugin-applemail` (via root script) or `.build/release/toby-plugin-applemail`.

Release installs copy it to `~/.toby/plugins/`.

## Install (development)

```bash
toby plugins install ./dist/toby-plugin-applemail --link --force
toby plugins doctor
toby connect applemail
```

## Notes

- macOS-only; implements Mail.app tools via AppleScript (`osascript`).
- No credentials — connect stores session state in `config.json` only.
- First-party Swift plugin reference (no Bun runtime embedded).
