# toby-plugin-macos

TypeScript (bun-package) installable Toby plugin for local **macOS system
control**. Implements [plugin protocol v1](../../docs/plugin-protocol.md).

The plugin is a thin TypeScript adapter that delegates all macOS-native
operations to **Toby.app's native API server** (localhost). Toby.app owns the
CoreWLAN, CoreAudio, IOBluetooth, IOKit, and AppKit calls and holds the TCC
permissions. The plugin itself does not need direct macOS framework access or
permission grants.

## Build

From repo root:

```bash
bun run build:plugin:macos
```

This copies the plugin directory to `dist/toby-plugin-macos` (a bun-package
directory, not a compiled binary). The bundled Focus shortcut files in
`BundledShortcuts/` are included in the copy.

Output: `dist/toby-plugin-macos/` (directory with `manifest.json`, `src/`,
`BundledShortcuts/`).

## Install (development)

```bash
toby plugins install ./dist/toby-plugin-macos --link --force
toby plugins doctor
toby plugins setup macos   # optional: import bundled Focus shortcuts
toby connect macos
```

Toby.app must be running for macOS system tools to function. The plugin
auto-launches Toby.app in the background if it is not already running when a
tool is invoked.

## Notes

- macOS-only.
- No credentials — connect stores session state in `config.json` only.
- TypeScript bun-package plugin (requires Bun runtime, no compilation).
- `setup` advertises via `status.setupAvailable` (when Toby.app is running) and
  opens signed `.shortcut` files for user confirmation in Shortcuts.app.
- Accessibility permission is granted to **Toby.app**, not the plugin, because
  all privileged operations route through the app's native API server.
