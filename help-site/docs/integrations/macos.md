---
sidebar_position: 8
title: macOS
---

# macOS

Connect Toby to local macOS system controls. Toby can inspect battery and Wi-Fi state, scan nearby Wi-Fi networks, list audio devices, switch audio outputs, run configured Shortcuts, and use optional Homebrew CLIs for the full feature set.

**CLI name:** `macos`

:::info[Platform]

**macOS only.** On Linux or Windows the integration can appear in configuration, but chat tools only run on a Mac.

:::

## Prerequisites

- macOS with Toby running locally on the Mac you want to control
- Homebrew if you want the full suite of functionality
- User-installed optional CLIs for full audio/Bluetooth control:
  - `switchaudio-osx` provides `SwitchAudioSource` for switching audio outputs
  - `blueutil` toggles Bluetooth power
- Optional Shortcuts in Shortcuts.app for Focus, Bluetooth, or Low Power Mode workflows you prefer to run through `/usr/bin/shortcuts`

Install the recommended CLIs:

```bash
brew install switchaudio-osx blueutil
```

Toby does **not** install these packages automatically. Without them, built-in macOS features still work where available, but audio output switching and direct Bluetooth power toggling are unavailable.

## Configure

```bash
toby config
```

Go to **Integrations → macOS**.

Useful fields:

| Field | Purpose |
| ----- | ------- |
| **Wi-Fi Device** | Optional interface override such as `en0` when auto-detect fails. |
| **SwitchAudioSource absolute path** | Optional path such as `/opt/homebrew/bin/SwitchAudioSource` when Toby cannot see your Homebrew `PATH`. |
| **Shortcut — Focus / DND ON/OFF** | Exact Shortcut names Toby can run for Focus or Do Not Disturb. |
| **Shortcut — Bluetooth ON/OFF** | Exact Shortcut names for Bluetooth if you do not use `blueutil`. |
| **Shortcut — Low Power Mode ON/OFF** | Exact Shortcut names for Low Power Mode if `pmset` requires privileges. |

Save after editing.

## Connect

```bash
toby connect macos
```

Toby runs a quick macOS subsystem check and stores a connected flag in `~/.toby/config.json`.

## Verify

```bash
toby status integration -i macos
```

If `SwitchAudioSource` is installed but Toby cannot find it, set **SwitchAudioSource absolute path** to:

```text
/opt/homebrew/bin/SwitchAudioSource
```

Intel Homebrew installs may use:

```text
/usr/local/bin/SwitchAudioSource
```

## Capabilities

| Capability | Tooling |
| ---------- | ------- |
| Battery status | `pmset -g batt` and `system_profiler SPBatteryDataType` |
| Wi-Fi status and power | `networksetup` with Wi-Fi interface discovery |
| Nearby Wi-Fi networks | `airport` when available, otherwise `system_profiler SPAirPortDataType` |
| Audio inputs and outputs | `SwitchAudioSource -a -t input/output` when installed, otherwise `system_profiler SPAudioDataType` |
| Switch audio output | Requires `SwitchAudioSource` from `switchaudio-osx` |
| Bluetooth power | Requires `blueutil`, or configured Shortcuts |
| Focus / Do Not Disturb | Configured Shortcuts |
| Low Power Mode | `pmset` where permitted, or configured Shortcuts |

## Example chat prompts

- “List my audio inputs and outputs.”
- “Switch my audio output to Plugable Audio.”
- “Turn Wi-Fi off.”
- “Show nearby Wi-Fi networks.”
- “Run my Focus on shortcut.”

## Permissions and paths

- macOS may prompt for Automation permissions when Toby runs Shortcuts or controls other apps.
- Toby never runs `sudo` for you. If `pmset` needs administrator privileges, use a Shortcut or run the privileged command yourself.
- Cursor, IDE, and daemon launches often have a smaller `PATH` than Terminal. Toby probes `/opt/homebrew/bin`, `/usr/local/bin`, enriched `PATH`, and a login shell, but you can pin `SwitchAudioSource` with the configure field if needed.

## Limitations

- Notification Center is not exposed through a stable public CLI, so Toby does not list notifications.
- `airport` is deprecated or disabled on many Sonoma 14.4+ systems; Toby falls back to `system_profiler SPAirPortDataType` for nearby Wi-Fi where possible.
- Bluetooth control requires `blueutil` for direct CLI power toggles. Without it, use user-created Shortcuts.

## Disconnect

```bash
toby disconnect macos
```

This clears Toby’s connection flag; it does not uninstall Homebrew tools or delete Shortcuts.

## Related

- [Integrations overview](overview)
- [Apple Mail](apple-mail)
- [Apple Calendar](apple-calendar)
- [Configure and connect](../getting-started/configure-and-status)
