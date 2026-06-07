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

## Bundled shortcuts (optional setup)

The plugin ships signed **Toby Focus On** and **Toby Focus Off** shortcuts for
Focus / Do Not Disturb control via `macShortcutRun`. Apple requires a one-click
confirmation in Shortcuts.app to import them — Toby cannot install silently.

After install, Toby may prompt to run setup, or run it manually:

```bash
toby plugins setup macos
```

Setup is idempotent: shortcuts already listed by `shortcuts list` are skipped.
Re-run setup anytime to import any shortcuts you have not added yet.

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

Mutating calls respect **`dry run`** modes from `toby chat` when enabled.

## Permissions and prompts

Depending on OS version and invoking app (Terminal, Cursor agent, daemon):

| Area | Typical prompt |
| ---- | ---------------- |
| Wi‑Fi scan | CoreWLAN may require Location Services authorization on first use. |
| Bluetooth | Plugin Info.plist declares `NSBluetoothAlwaysUsageDescription`. |
| Shortcuts | macOS may prompt for Automation permissions when Shortcuts access other apps. |
| `pmset` | Low Power Mode writes may require admin privileges. Use a Shortcut or manual `sudo` per Apple guidance. |

Toby never runs **`sudo`** for you.

## Limitations

- **Display brightness** on Apple Silicon Macs: IODisplay brightness APIs do not function on some Apple Silicon configurations. The `macDisplayBrightness` and `macDisplaySetBrightness` tools may return errors on affected hardware.
- **Notification Center** is not exposed through a stable public API, so Toby does not list notifications.

See also [`integrations.md`](integrations.md) and [`plugin-protocol.md`](plugin-protocol.md).
