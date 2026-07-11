---
sidebar_position: 10
title: macOS
---

# <span class="docs-brand-title"><img class="docs-brand-icon" src="/img/integrations/macos.png" alt="" width="40" height="40" />macOS</span>

Connect Toby to local macOS system controls. The macOS plugin delegates all
macOS-native operations to **Toby.app's native API server** — CoreWLAN,
CoreAudio, IOBluetooth, IOKit, and AppKit run inside Toby.app, which holds the
TCC permissions. No third-party tools or Homebrew packages are required.

:::info[Platform]

**macOS only.** The plugin is included automatically with Toby.app installs
under `~/.toby/plugins/`.

:::

## Prerequisites

- macOS 14+ (Sonoma or later) with Toby running locally on the Mac you want to control
- Toby.app running for macOS system tools (the plugin auto-launches Toby.app in the background if needed)

## Connect

Open **Toby.app → Integrations → macOS** and click **Connect**.

Toby probes native system APIs and stores a connected flag in `~/.toby/config.json`.

## Optional setup (bundled shortcuts)

The macOS plugin can install signed **Toby Focus On** and **Toby Focus Off**
shortcuts. Apple requires you to confirm each import in Shortcuts.app.

If the integration offers a **Setup** action on its detail page (or during
onboarding), run it once. Setup is idempotent — shortcuts already on your Mac
are skipped.

## Configure

Open **Toby.app → Integrations → macOS**. There are no credential fields —
connect is a one-time session flag on this Mac.

## Verify

Return to **Integrations** in the sidebar. macOS should show as connected and healthy.

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
| Low Power Mode status | `macLowPowerModeStatus` | system power settings |
| Low Power Mode set | `macLowPowerModeSet` | system power settings |
| Run Shortcut | `macShortcutRun` | Shortcuts |
| System information | `macSystemInfo` | system info |
| Notifications | `macNotificationsPeek` | **Not supported** |

Mutating calls respect **dry run** when the chat session has dry-run enabled.

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
| Bluetooth | Toby.app may prompt for Bluetooth access on first use. |
| Window control | Minimize and restore tools route through Toby.app's native API server. Grant Accessibility to Toby.app in System Settings. |
| Shortcuts | macOS may prompt for Automation permissions when Shortcuts access other apps. |
| Low Power Mode | Changing Low Power Mode may require admin privileges on some Macs. |

Toby never escalates privileges for you without an explicit system prompt.

## Limitations

- **Display brightness** on some Apple Silicon Macs may not be readable or adjustable through the IODisplay APIs.
- **Notification Center** is not exposed through a stable public API, so Toby does not list notifications.

## Disconnect

Open the macOS detail page and click **Disconnect**. This clears Toby's connection flag; it does not modify system settings.

## Related

- [Integrations overview](overview)
- [Apple Calendar](apple-calendar)
- [Apple Reminders](apple-reminders)
- [Apple Contacts](apple-contacts)
- [Toby.app](../toby-app)
- [Configure and connect](../getting-started/configure-and-status)
