---
sidebar_position: 8
title: macOS
---

# macOS

Connect Toby to local macOS system controls. Toby uses a native **`toby-macos`** helper binary that calls CoreWLAN, CoreAudio, IOBluetooth, IOKit, and AppKit directly — no third-party CLIs or Homebrew packages are required.

**CLI name:** `macos`

:::info[Platform]

**macOS only.** On Linux or Windows the integration can appear in configuration, but chat tools only run on a Mac.

:::

## Prerequisites

- macOS 14+ (Sonoma or later) with Toby running locally on the Mac you want to control
- The `toby-macos` helper binary, installed to `~/.toby/helpers/` by the install/upgrade flow (included automatically in releases)
- Optional Shortcuts in Shortcuts.app for Focus, Bluetooth, or Low Power Mode workflows you prefer to run through Shortcuts rather than direct API control

No Homebrew packages are needed. The native helper replaces the previous dependencies on `SwitchAudioSource`, `blueutil`, `airport`, and `networksetup`.

## Connect

```bash
toby connect macos
```

Toby probes the `toby-macos` helper and stores a connected flag in `~/.toby/config.json`.

## Configure

```bash
toby config
```

Go to **Integrations → macOS**.

Useful fields:

| Field | Purpose |
| ----- | ------- |
| **Wi-Fi Device** | Optional interface override such as `en0` when auto-detect fails. |
| **Shortcut — Focus / DND ON/OFF** | Exact Shortcut names Toby can run for Focus or Do Not Disturb. |
| **Shortcut — Bluetooth ON/OFF** | Exact Shortcut names for Bluetooth (alternative to direct IOBluetooth control). |
| **Shortcut — Low Power Mode ON/OFF** | Exact Shortcut names for Low Power Mode (alternative to `pmset`). |

Save after editing.

## Verify

```bash
toby status integration -i macos
```

## Capabilities

All capabilities use the native `toby-macos` helper and require no external tools:

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
| Run Shortcut | `macShortcutsRun` | `/usr/bin/shortcuts` |
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
| Bluetooth | The helper Info.plist declares `NSBluetoothAlwaysUsageDescription`. |
| Shortcuts | macOS may prompt for Automation permissions when Shortcuts access other apps. |
| Low Power Mode | `pmset` writes may require admin privileges. Use a Shortcut or run `sudo pmset` manually. |

Toby never runs `sudo` for you.

## Limitations

- **Display brightness** on some Apple Silicon Macs may not be readable or adjustable through the IODisplay APIs. A future update may address this.
- **Notification Center** is not exposed through a stable public API, so Toby does not list notifications.

## Disconnect

```bash
toby disconnect macos
```

This clears Toby's connection flag; it does not delete Shortcuts or modify system settings.

## Related

- [Integrations overview](overview)
- [Apple Mail](apple-mail)
- [Apple Calendar](apple-calendar)
- [Configure and connect](../getting-started/configure-and-status)
