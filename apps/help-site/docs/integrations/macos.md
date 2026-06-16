---
sidebar_position: 8
title: macOS
---

# macOS

Connect Toby to local macOS system controls. Toby ships **`toby-plugin-macos`**, a Swift plugin that calls CoreWLAN, CoreAudio, IOBluetooth, IOKit, and AppKit directly in-process — no third-party CLIs or Homebrew packages are required.

**CLI name:** `macos`

:::info[Platform]

**macOS only.** The plugin must be installed under `~/.toby/plugins/` (included automatically in releases).

:::

## Prerequisites

- macOS 14+ (Sonoma or later) with Toby running locally on the Mac you want to control
- `toby-plugin-macos` installed to `~/.toby/plugins/` by the install/upgrade flow
- Toby.app running for Accessibility-gated window operations such as minimize and restore

## Connect

```bash
toby connect macos
```

Toby probes native system APIs and stores a connected flag in `~/.toby/config.json`.

## Optional setup (bundled shortcuts)

The macOS plugin can install signed **Toby Focus On** and **Toby Focus Off**
shortcuts. Apple requires you to confirm each import in Shortcuts.app.

```bash
toby plugins setup macos
```

After `toby plugins install`, Toby may prompt to run setup when the plugin
advertises it. Setup is idempotent — shortcuts already on your Mac are skipped.

## Configure

```bash
toby config
```

Go to **Integrations → macOS**. There are no credential fields — connect is a one-time session flag on this Mac.

## Verify

```bash
toby status integration -i macos
toby plugins doctor
```

## Capabilities

| Capability | Tool | Native framework |
| ---------- | ---- | ---------------- |
| Battery status | `macBatteryStatus` | IOKit PowerSources + AppleSmartBattery |
| Wi‑Fi status and power | `macWifiStatus` / `macWifiSetPower` | CoreWLAN |
| Nearby Wi‑Fi networks | `macWifiScanNearby` | CoreWLAN |
| Audio inputs and outputs | `macAudioListOutputs` | CoreAudio |
| Switch audio output | `macAudioSwitchOutput` | CoreAudio |
| Audio volume | `macAudioVolume` | CoreAudio |
| Set audio volume | `macAudioSetVolume` | CoreAudio |
| Mute / unmute | `macAudioSetMute` | CoreAudio |
| Bluetooth status | `macBluetoothStatus` | IOBluetooth |
| Bluetooth power | `macBluetoothSetPower` | IOBluetooth |
| Display brightness | `macDisplayBrightness` | IOKit IODisplay |
| Set display brightness | `macDisplaySetBrightness` | IOKit IODisplay |
| Read clipboard | `macClipboardRead` | AppKit NSPasteboard |
| Write clipboard | `macClipboardWrite` | AppKit NSPasteboard |
| Low Power Mode status | `macLowPowerModeStatus` | `pmset` |
| Low Power Mode set | `macLowPowerModeSet` | `pmset` |
| Run Shortcut | `macShortcutRun` | `/usr/bin/shortcuts` |
| System information | `macSystemInfo` | sysctl / ProcessInfo |
| Notifications | `macNotificationsPeek` | **Not supported** |

Mutating calls respect **dry run** modes from `toby chat` when enabled.

## Example chat prompts

- "List my audio inputs and outputs."
- "Switch my audio output to Plugable Audio."
- "What's my current volume?"
- "Set volume to 50."
- "Mute the audio."
- "Turn Wi‑Fi off."
- "Show nearby Wi‑Fi networks."
- "What's my display brightness?"
- "Set brightness to 80."
- "Read my clipboard."
- "Copy this to my clipboard: Hello world."
- "Show system info."
- "Run my Focus on shortcut."

## Permissions

| Area | Notes |
| ---- | ----- |
| Wi‑Fi scan | CoreWLAN may require Location Services authorization on first use. |
| Bluetooth | Plugin Info.plist declares `NSBluetoothAlwaysUsageDescription`. |
| Window control | Minimize and restore tools route through Toby.app's native API server when available, so grant Accessibility to Toby.app in System Settings. |
| Shortcuts | macOS may prompt for Automation permissions when Shortcuts access other apps. |
| Low Power Mode | `pmset` writes may require admin privileges. Use a Shortcut or run `sudo pmset` manually. |

Toby never runs `sudo` for you.

## Limitations

- **Display brightness** on some Apple Silicon Macs may not be readable or adjustable through the IODisplay APIs.
- **Notification Center** is not exposed through a stable public API, so Toby does not list notifications.

## Disconnect

```bash
toby disconnect macos
```

This clears Toby's connection flag; it does not modify system settings.

## Related

- [Integrations overview](overview)
- [Apple Calendar](apple-calendar)
- [Toby.app](../toby-app)
- [Configure and connect](../getting-started/configure-and-status)
