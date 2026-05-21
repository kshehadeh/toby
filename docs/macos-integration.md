# macOS integration

First-party integration id: **`macos`**.

## Platform

**macOS (Darwin) only.** The module is registered on any host so Toby can expose configure wiring and CI parser tests; chat tools short-circuit with a friendly error elsewhere.

Run **`toby connect macos`** once on your Mac after `sw_vers`/`networksetup`/`pmset` smoke checks succeed. Connection stores `integrations.macos.connectedAt` in **`~/.toby/config.json`**. Disconnect with **`toby disconnect macos`**.

Homebrew binaries required for the full macOS integration:

| Binary | Brew package | Purpose |
| ------ | ------------- | ------- |
| `SwitchAudioSource` | `switchaudio-osx` | `macAudioSwitchOutput` |
| `blueutil` | `blueutil` | `macBluetoothSetPower` |

Install them yourself before using the full audio/Bluetooth tool surface:

```bash
brew install switchaudio-osx blueutil
```

Toby does **not** install Homebrew packages for you. Without these binaries, Toby can still use built-in macOS tools for Wi‑Fi, battery, audio listing via `system_profiler`, Shortcuts, and Low Power Mode probes, but it cannot switch audio outputs via `macAudioSwitchOutput` or toggle Bluetooth via `blueutil`.

Toby resolves these by probing **`/opt/homebrew/bin`** and **`/usr/local/bin`**, enriched **`PATH` `which`**, and (last resort) a **login-shell** `command -v` similar to Terminal — Cursor/IDE/daemon launches often omit Homebrew on `PATH`. Use Configure **`switchAudioSourcePath`** to pin **`/opt/homebrew/bin/SwitchAudioSource`** if anything still hides it.

## Configure fields (`macos.*`)

All values are plaintext (no masking). Shortcut strings must match **exact** names in Shortcuts.app.

| Key | Meaning |
| --- | ------- |
| `wifiPreferredDevice` | Optional override (e.g. `en0`) when Wi‑Fi auto-detect fails. |
| `switchAudioSourcePath` | Absolute path to `SwitchAudioSource` when Toby’s process lacks your Terminal `PATH` (typically `/opt/homebrew/bin/SwitchAudioSource`). |
| `shortcutFocusOn` / `shortcutFocusOff` | Shortcuts toggling Focus / Do Not Disturb. |
| `shortcutBluetoothOn` / `shortcutBluetoothOff` | Shortcut-based Bluetooth toggle. |
| `shortcutLowPowerOn` / `shortcutLowPowerOff` | Shortcut-based Low Power Mode toggle. |
| `notes` | Free-form notes shown in Configure. |

The AI uses **`macShortcutsRun`** with a preset (`focusOn`, `focusOff`, …); each preset resolves to one of those shortcut name fields.

## Chat tools

| Tool | Approach |
| ---- | -------- |
| `macBatteryStatus` | `pmset -g batt` plus `system_profiler SPBatteryDataType` snippet |
| `macWifiScanNearby` | Tries **`airport -s`**; on Sonoma 14.4+ (deprecated `airport`) uses **`system_profiler SPAirPortDataType`** *Other Local Wi‑Fi Networks* — see tool `scanSource` |
| `macWifiStatus` / `macWifiSetPower` | Resolve Wi‑Fi NIC from `-listallhardwareports`, then `-getairportpower` / `-setairportpower` |
| `macAudioListOutputs` | Lists outputs and inputs; prefers `SwitchAudioSource -a -t output/input` exact names when installed, otherwise parses `system_profiler SPAudioDataType` |
| `macAudioSwitchOutput` | Requires user-installed `SwitchAudioSource` (`brew install switchaudio-osx`) |
| `macBluetoothSetPower` | Requires user-installed `blueutil` (`brew install blueutil`); otherwise use configured Shortcuts |
| `macLowPowerModeStatus` | `pmset -g custom` lines |
| `macLowPowerModeSet` | `pmset lowpowermode` — often needs privileges; Prefer Shortcuts fallback |
| `macShortcutsRun` | `/usr/bin/shortcuts run "<name>"` from configured presets |
| `macNotificationsPeek` | **Explicitly unsupported** — Notification Center has no stable CLI |

Mutating calls respect **`dry run`** modes from `toby chat` when enabled.

## Permissions and prompts

Depending on OS version and invoking app (Terminal, Cursor agent, daemon):

| Area | Typical prompt |
| ---- | ---------------- |
| Wi‑Fi / `networksetup` | May require automation or elevated context for power toggles. |
| **`airport` scan** (`macWifiScanNearby`, first tier) | **Deprecated / broken from Sonoma 14.4+** — Toby falls back to **SPAirPortDataType** scan when needed. Requires Wi‑Fi **on**. |
| Terminal / Toby | Automation for **Shortcuts** runner if Shortcuts accesses other apps. |
| `blueutil`, `SwitchAudioSource` | No Apple prompts beyond normal executable permissions unless sandboxed incorrectly. |

Toby never runs **`sudo`** for you — if `pmset` reports permission denial, toggle Low Power via a Shortcut or manual `sudo` per Apple guidance.

## Limitations

- **`macWifiScanNearby`**: **Sonoma 14.4+** deprecates **`airport`**; Toby then uses **`system_profiler SPAirPortDataType`** (“Other Local Wi‑Fi Networks”). Both paths parse **plaintext** only — **`rawPreviewTail`** helps when fields move between OS releases.
- **Bluetooth focus** via Apple-provided CLI is weak; **`blueutil`** or Shortcuts are the realistic paths.

See also [`integrations.md`](integrations.md) and [`apple-mail.md`](apple-mail.md) for the Automation permission model reused by other macOS tooling.
