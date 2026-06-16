# macOS integration

First-party installable plugin id: **`macos`** (`toby-plugin-macos`).

## Platform

**macOS (Darwin) only.** The plugin is discovered from `~/.toby/plugins/` when present. Chat tools return a friendly error on non-macOS hosts.

Releases and upgrades install `toby-plugin-macos` automatically. For development:

```bash
bun run build:plugin:macos
toby plugins install ./dist/toby-plugin-macos --link --force
toby plugins doctor
```

Run **`toby connect macos`** once on your Mac. Connection stores `integrations.macos.connectedAt` in **`~/.toby/config.json`**. Disconnect with **`toby disconnect macos`**.

## Plugin setup

The plugin ships signed **Toby Focus On** and **Toby Focus Off** shortcuts for
Focus / Do Not Disturb control via `macShortcutRun`. Apple requires a one-click
confirmation in Shortcuts.app to import them — Toby cannot install silently.

Setup also requests **Accessibility permission** for the plugin binary so the
window-minimize and window-unminimize tools (`macWindowsMinimizeAll`,
`macWindowsUnminimizeAll`, `macWindowMinimizeApp`, `macWindowUnminimizeApp`)
can work. Because macOS TCC is keyed to the calling executable, the binary that
needs the grant is `~/.toby/plugins/toby-plugin-macos` itself, not the host
terminal or the Toby daemon.

After install, Toby may prompt to run setup, or run it manually:

```bash
toby plugins setup macos
```

Setup is idempotent:

- Shortcuts already listed by `shortcuts list` are skipped (matching is case‑insensitive and whitespace‑normalized, and a local state file tracks which imports have already been opened so the UI never reappears).
- The Accessibility step is skipped when the plugin is already trusted; otherwise it triggers the macOS "would like to control your computer" prompt that surfaces toby-plugin-macos in System Settings → Privacy & Security → Accessibility with a single toggle.

Re-run setup anytime to finish steps you have not completed yet. If `shortcuts list` does not reliably detect a shortcut (for example, due to iCloud sync delays), the state file at `~/.toby/plugin-macos-setup-state.json` prevents the import UI from being opened again.

Build regenerates signed shortcuts via [`scripts/build-bundled-shortcuts.sh`](../scripts/build-bundled-shortcuts.sh) before `swift build`. On recent macOS, `shortcuts sign` may print harmless `debugDescription` stderr noise; CI reuses the committed signed shortcuts because GitHub runners are not signed into iCloud.

## Implementation

All macOS system operations run **in-process** inside the Swift plugin — CoreWLAN, CoreAudio, IOBluetooth, IOKit, and AppKit. No separate helper binary or Homebrew packages are required.

Source: [`apps/plugin-macos/`](../apps/plugin-macos/).

| Domain | Native framework |
| ------ | ---------------- |
| Wi‑Fi | CoreWLAN |
| Audio | CoreAudio |
| Bluetooth | IOBluetooth |
| Battery | IOKit PowerSources |
| Display | IOKit IODisplay |
| Low Power | wraps `pmset` |
| Shortcuts | wraps `/usr/bin/shortcuts` |
| Clipboard | AppKit NSPasteboard |
| Windows | AppKit `NSRunningApplication` (hide/show) + `AXUIElement` (minimize/unminimize) |
| System Info | sysctl / ProcessInfo |

## Configure fields (`macos.*`)

The macOS integration has no configurable fields. System control is handled by native APIs and runtime tool inputs.

## Chat tools

| Tool | Approach |
| ---- | -------- |
| `macBatteryStatus` | IOKit PowerSources + AppleSmartBattery cycle count |
| `macWifiScanNearby` | CoreWLAN scan |
| `macWifiStatus` / `macWifiSetPower` | CoreWLAN |
| `macAudioListOutputs` | CoreAudio device list |
| `macAudioSwitchOutput` | CoreAudio output switch |
| `macAudioVolume` | CoreAudio volume read |
| `macAudioSetVolume` | CoreAudio volume set |
| `macAudioSetMute` | CoreAudio mute toggle |
| `macBluetoothStatus` | IOBluetooth power state + device list |
| `macBluetoothSetPower` | IOBluetooth power toggle |
| `macDisplayBrightness` | IOKit display brightness |
| `macDisplaySetBrightness` | IOKit display brightness set |
| `macClipboardRead` | NSPasteboard read |
| `macClipboardWrite` | NSPasteboard write |
| `macLowPowerModeStatus` | `pmset` read |
| `macLowPowerModeSet` | `pmset` write — often needs privileges |
| `macShortcutRun` | `/usr/bin/shortcuts run "<name>"` |
| `macSystemInfo` | sysctl/ProcessInfo/sw_vers |
| `macNotificationsPeek` | **Explicitly unsupported** — Notification Center has no stable API |
| `macWindowsHideAll` | AppKit `NSRunningApplication.hide()` for every other regular app |
| `macWindowsShowAll` | AppKit `NSRunningApplication.unhide()` |
| `macWindowsMinimizeAll` | `AXUIElement` + `kAXMinimizedAttribute` across all GUI apps |
| `macWindowsUnminimizeAll` | `AXUIElement` + `kAXMinimizedAttribute` restore across all GUI apps |
| `macWindowHideApp` | AppKit hide, matched by localized name / bundle id substring |
| `macWindowMinimizeApp` | `AXUIElement` minimize for a specific app |
| `macWindowUnminimizeApp` | `AXUIElement` unminimize for a specific app |

Mutating calls respect **`dry run`** modes from `toby chat` when enabled.

## Permissions and prompts

Depending on OS version and invoking app (Terminal, Cursor agent, daemon):

| Area | Typical prompt |
| ---- | ---------------- |
| Wi‑Fi scan | CoreWLAN may require Location Services authorization on first use. |
| Bluetooth | Plugin Info.plist declares `NSBluetoothAlwaysUsageDescription`. |
| Shortcuts | macOS may prompt for Automation permissions when Shortcuts access other apps. |
| `pmset` | Low Power Mode writes may require admin privileges. Use a Shortcut or manual `sudo` per Apple guidance. |
| Window minimize / unminimize | `macWindowsMinimizeAll`, `macWindowsUnminimizeAll`, `macWindowMinimizeApp`, and `macWindowUnminimizeApp` first try Toby.app's native API server (which has a proper app bundle identity for Accessibility). If Toby.app is not running, they fall back to in-process `AXUIElement` calls, which require Accessibility permission for the **plugin binary itself** (`~/.toby/plugins/toby-plugin-macos`) under System Settings → Privacy & Security → Accessibility. Run `toby plugins setup macos` to trigger the prompt. When using Toby.app, the user grants Accessibility to "Toby" instead of the plugin binary. Hide/show work without extra permission. |

Toby never runs **`sudo`** for you.

## Logs

The plugin writes a structured JSON-line log to **`~/.toby/plugin-macos.log`** (same schema as `daemon.log`: `{ ts, level, category, type, data }`, with `category: "plugin-macos"`). Errors from Accessibility/AX calls, tool failures, and setup actions are recorded along with a process fingerprint (`pid`, `ppid`, `executable`, `parentExecutable`, `accessibilityTrusted`). Tail it while reproducing an issue:

```bash
tail -f ~/.toby/plugin-macos.log
```

The `executable` and `parentExecutable` fields are particularly useful for figuring out which binary macOS attributes Accessibility calls to. The file rotates automatically once it exceeds ~512 KB.

## Limitations

- **Display brightness** on Apple Silicon Macs: IODisplay brightness APIs do not function on some Apple Silicon configurations. The `macDisplayBrightness` and `macDisplaySetBrightness` tools may return errors on affected hardware.
- **Notification Center** is not exposed through a stable public API, so Toby does not list notifications.

See also [`integrations.md`](integrations.md) and [`plugin-protocol.md`](plugin-protocol.md).
