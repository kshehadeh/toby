# toby-plugin-macos

Swift installable Toby plugin for local **macOS system control**. Implements
[plugin protocol v1](../../docs/plugin-protocol.md).

Native APIs (CoreWLAN, CoreAudio, IOBluetooth, IOKit, AppKit) run in-process —
no separate `toby-macos` helper binary.

## Build

From repo root:

```bash
bun run build:plugin:macos
```

This runs `scripts/build-bundled-shortcuts.sh` (generate + sign Focus On/Off
shortcuts into `Sources/TobyPluginMacOSLib/BundledShortcuts/`), then compiles
the plugin with those resources embedded.

Output: `dist/toby-plugin-macos`.

## Install (development)

```bash
toby plugins install ./dist/toby-plugin-macos --link --force
toby plugins doctor
toby plugins setup macos   # optional: import bundled Focus shortcuts
toby connect macos
```

## Notes

- macOS-only.
- No credentials — connect stores session state in `config.json` only.
- First-party Swift plugin (no Bun runtime embedded).
- `setup` advertises via `status.setupAvailable` and opens signed `.shortcut`
  files for user confirmation in Shortcuts.app.
