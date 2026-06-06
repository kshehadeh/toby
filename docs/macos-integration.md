# macOS integration

First-party integration id: **`macos`**.

## Platform

**macOS (Darwin) only.** The module is registered on any host so Toby can expose configure wiring and CI parser tests; chat tools short-circuit with a friendly error elsewhere.

Run **`toby connect macos`** once on your Mac. Connection stores `integrations.macos.connectedAt` in **`~/.toby/config.json`**. Disconnect with **`toby disconnect macos`**.

## Native system helper

All macOS system operations are handled by the **`toby-macos`** native helper — a Swift binary that calls CoreWLAN, CoreAudio, IOBluetooth, IOKit, and AppKit directly. No Homebrew packages or third-party CLIs are required.

The install/upgrade flow places `toby-macos` (and `toby-listener`) under `~/.toby/helpers/`, keeping the `toby` binary the only thing installed on your `PATH`. It must be present for the macOS integration to function — if missing, Toby fails with a clear error message.

| Domain | Helper command | Native framework |
| ------ | -------------- | ---------------- |
| Wi‑Fi | `toby-macos wifi status/scan/power` | CoreWLAN |
| Audio | `toby-macos audio list/switch-output/volume/set-volume/set-mute` | CoreAudio |
| Bluetooth | `toby-macos bluetooth status/power` | IOBluetooth |
| Battery | `toby-macos battery status` | IOKit PowerSources |
| Display | `toby-macos display brightness/set-brightness` | IOKit IODisplay |
| Low Power | `toby-macos lowpower status/set` | wraps `pmset` |
| Focus | `toby-macos focus status/list/set/off` | DoNotDisturb (private) |
| Shortcuts | `toby-macos shortcuts run` | wraps `/usr/bin/shortcuts` |
| Clipboard | `toby-macos clipboard read/write` | AppKit NSPasteboard |
| System Info | `toby-macos system info` | sysctl / ProcessInfo |

Resolution order for the helper binary:

1. `TOBY_MACOS_HELPER` environment variable
2. `~/.toby/helpers/toby-macos` (the install/upgrade location)
3. Sibling of the Toby executable (e.g. `/usr/local/bin/toby-macos`, for legacy installs)
4. Development build at `apps/macos-helper/.build/release/toby-macos-helper`

## Configure fields (`macos.*`)

The macOS integration currently has no configurable fields. System control is handled by the native helper and runtime tool inputs.

## Chat tools

| Tool | Approach |
| ---- | -------- |
| `macBatteryStatus` | IOKit PowerSources + AppleSmartBattery cycle count via `toby-macos battery status` |
| `macWifiScanNearby` | CoreWLAN scan via `toby-macos wifi scan` |
| `macWifiStatus` / `macWifiSetPower` | CoreWLAN via `toby-macos wifi status/power` |
| `macAudioListOutputs` | CoreAudio device list via `toby-macos audio list` |
| `macAudioSwitchOutput` | CoreAudio output switch via `toby-macos audio switch-output` |
| `macAudioVolume` | CoreAudio volume read via `toby-macos audio volume` |
| `macAudioSetVolume` | CoreAudio volume set via `toby-macos audio set-volume` |
| `macAudioSetMute` | CoreAudio mute toggle via `toby-macos audio set-mute` |
| `macBluetoothStatus` | IOBluetooth power state + device list via `toby-macos bluetooth status` |
| `macBluetoothSetPower` | IOBluetooth power toggle via `toby-macos bluetooth power` |
| `macDisplayBrightness` | IOKit display brightness via `toby-macos display brightness` |
| `macDisplaySetBrightness` | IOKit display brightness set via `toby-macos display set-brightness` |
| `macClipboardRead` | NSPasteboard read via `toby-macos clipboard read` |
| `macClipboardWrite` | NSPasteboard write via `toby-macos clipboard write` (text piped via stdin) |
| `macLowPowerModeStatus` | `pmset` read via `toby-macos lowpower status` |
| `macLowPowerModeSet` | `pmset` write via `toby-macos lowpower set` — often needs privileges |
| `macShortcutRun` | `/usr/bin/shortcuts run "<name>"` via `toby-macos shortcuts run` |
| `macSystemInfo` | sysctl/ProcessInfo/sw_vers via `toby-macos system info` |
| `macNotificationsPeek` | **Explicitly unsupported** — Notification Center has no stable API |

Mutating calls respect **`dry run`** modes from `toby chat` when enabled.

## Permissions and prompts

Depending on OS version and invoking app (Terminal, Cursor agent, daemon):

| Area | Typical prompt |
| ---- | ---------------- |
| Wi‑Fi scan | CoreWLAN may require Location Services authorization on first use. |
| Microphone | Helper Info.plist declares `NSMicrophoneUsageDescription` for future audio capture features. |
| Bluetooth | Helper Info.plist declares `NSBluetoothAlwaysUsageDescription`. |
| Shortcuts | macOS may prompt for Automation permissions when Shortcuts access other apps. |
| `pmset` | Low Power Mode writes may require admin privileges. Use a Shortcut or manual `sudo` per Apple guidance. |

Toby never runs **`sudo`** for you.

## Limitations

- **Display brightness** on Apple Silicon Macs: IODisplay brightness APIs do not function on some Apple Silicon configurations. The `macDisplayBrightness` and `macDisplaySetBrightness` tools may return errors on affected hardware. A future update may use the private CoreBrightness framework.
- **Notification Center** is not exposed through a stable public API, so Toby does not list notifications.

See also [`integrations.md`](integrations.md) and [`apple-mail.md`](apple-mail.md) for the Automation permission model reused by other macOS tooling.
