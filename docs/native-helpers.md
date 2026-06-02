# Native helpers

Native helpers are small platform-specific executables that Toby can spawn when
Node/Bun is not the right boundary for talking to the operating system.

Two helpers currently exist:

- **toby-audio-helper** — macOS audio capture for `toby listen` (line-delimited JSON streaming protocol)
- **toby-macos-helper** — macOS system control for the `macos` integration (single-invocation JSON protocol)

```text
apps/audio-helper/
  Package.swift
  Sources/TobyAudioHelper/main.swift

apps/macos-helper/
  Package.swift
  Info.plist
  Sources/TobyMacOSHelper/
    CLI.swift
    AudioCommands.swift
    BatteryCommands.swift
    BluetoothCommands.swift
    ClipboardCommands.swift
    DisplayCommands.swift
    FocusCommands.swift
    LowPowerCommands.swift
    ShortcutsCommands.swift
    SystemInfoCommands.swift
    WiFiCommands.swift
```

Use this document as the reference pattern when adding future helpers for native
system interaction.

## Why helpers exist

Toby is primarily a TypeScript CLI. That works well for command routing,
configuration, AI calls, storage, and terminal UI. It is not always the best
place to call privileged or platform-native APIs.

Use a native helper when the feature needs:

- Frameworks that are only available from native code, such as macOS
  `AVFoundation`, `ScreenCaptureKit`, EventKit, Accessibility, or Security.
- OS permission prompts that are tied to a signed executable or native
  framework behavior.
- Long-running streaming APIs where a focused native process can own resource
  cleanup.
- Platform-specific behavior that should not leak through the rest of the
  TypeScript application.

Do not use a helper for ordinary shell commands, HTTP APIs, config transforms,
or integration-specific business logic. Keep that code in TypeScript unless the
native boundary is doing real work.

## The pattern

The TypeScript app owns product behavior. The helper owns native mechanics.

Helpers follow one of two protocol patterns depending on the use case:

### Streaming protocol (toby-audio-helper)

For `toby listen`, the audio helper uses a **line-delimited JSON streaming**
protocol because recording is a long-running session:

- The CLI command, Ink UI, recording list, metadata, confirmation prompts, and
  storage policy live in TypeScript.
- The Swift helper handles microphone capture, system audio capture, macOS
  permissions, audio file writing, and combined audio export.
- The helper reports progress through a line-delimited JSON protocol.
- Toby sends a small JSON command over stdin when the recording should stop.

### Request/response protocol (toby-macos-helper)

For the `macos` integration, the system helper uses a **single-invocation JSON**
protocol because each call does one thing and exits:

- TypeScript wrapper functions (`helperWifiStatus`, `helperAudioList`, etc.)
  spawn the helper with `[domain, action, ...flags]` arguments.
- The helper performs one native operation, writes a single JSON object to
  stdout, and exits.
- TypeScript parses the JSON and returns typed data or throws on error.
- Optional `input` option on `execSystemHelper` pipes data via stdin (used by
  `clipboard write` to avoid ARG_MAX limits).

Example successful response:

```json
{"ok":true,"helperVersion":"0.1.0","data":{"powerOn":true,"ssid":"MyNetwork","rssi":-42}}
```

Example error response:

```json
{"ok":false,"helperVersion":"0.1.0","error":"Wi-Fi is not powered on","code":"wifi_off"}
```

Choose the request/response pattern when the helper does discrete,
short-lived operations. Choose the streaming pattern when the helper manages a
long-lived session with progress events.

## Process boundary

Helpers should be spawned as child processes and communicate over stdin/stdout.

### Streaming (JSON-lines)

For long-running helpers, prefer a JSON-lines protocol:

- Each stdout line is one complete JSON object.
- stderr is for diagnostic text only.
- stdin accepts JSON command objects from Toby.
- Paths in protocol messages are relative to a Toby-provided output directory
  when possible.
- The helper exits when its job is complete or unrecoverable.

JSON lines are easy to parse incrementally, easy to log, and do not require a
server, socket, or long-lived daemon. They also make it clear which side owns
each lifecycle event.

Example event stream:

```json
{"type":"permission","service":"microphone","status":"prompting"}
{"type":"permission","service":"microphone","status":"granted"}
{"type":"ready","helperVersion":"0.2.0","files":{"mic":"mic.wav","system":"system.wav"}}
{"type":"status","message":"recording"}
{"type":"stopped","durationMs":12000,"files":{"mic":"mic.wav","system":"system.wav","combined":"combined.m4a"}}
```

Example stop command:

```json
{"type":"stop","action":"save"}
```

### Request/response (single JSON)

For short-lived helpers that do one thing per invocation:

- `spawnSync` with `[domain, action, ...flags]` as argv.
- stdout is a single JSON object (not line-delimited).
- Optional `input` option on `spawnSync` for piping data via stdin.
- stderr is for diagnostic text only.
- The helper exits after writing the response.

Example invocation:

```
toby-macos wifi status        → stdout: {"ok":true,"helperVersion":"0.1.0","data":{...}}
toby-macos audio volume       → stdout: {"ok":true,"helperVersion":"0.1.0","data":{...}}
toby-macos clipboard write --stdin  ← stdin: "text to clipboard", stdout: {"ok":true,...}
```

## Ownership rules

Keep helper responsibilities narrow:

- Parse only helper-specific flags.
- Request and use native permissions.
- Create native resources.
- Emit structured status, error, and result events.
- Clean up temporary native resources before exit.

Keep Toby responsibilities broad:

- Register the CLI command.
- Render the UI.
- Decide where files live.
- Persist metadata.
- Interpret helper events.
- Show recoverable errors.
- Delete, rename, or organize saved artifacts.

The helper should not know about Toby integrations, personas, chat sessions,
or UI state. Toby should not know the internal details of native framework
objects.

## File layout

Place helpers under `helpers/<helper-name>/`.

For Swift helpers, use a Swift Package Manager executable:

```text
helpers/<helper-name>/
  Package.swift
  Sources/<TargetName>/main.swift
```

Build commands should live in `package.json`, for example:

```json
{
  "scripts": {
    "build:audio-helper": "swift build -c release --package-path apps/audio-helper",
    "build:system-helper": "swift build -c release --package-path apps/macos-helper"
  }
}
```

Ignore generated build output in `.gitignore`.

## Resolution

TypeScript should resolve helpers in this order:

1. An explicit command option, such as `--helper /path/to/helper`.
2. An environment variable, such as `TOBY_AUDIO_HELPER`.
3. The packaged helper under `~/.toby/helpers/`, such as `~/.toby/helpers/toby-listener`.
4. A packaged sibling beside the compiled Toby binary (legacy installs).
5. The development build path under `helpers/<helper-name>/.build/release/`.

If a required helper is missing, fail with a message that tells the user how to
build it. Do not silently degrade into a broken UI state.

## Versioning

Helpers should emit a `helperVersion` in their first ready/result event. Toby can
use this for diagnostics and future compatibility checks.

Prefer additive protocol changes:

- Add new event fields instead of changing existing field meanings.
- Keep unknown event fields harmless.
- Keep command objects small and explicit.
- Bump the helper version when behavior changes in a way that affects Toby.

## Errors

Helpers should emit structured error events before exiting when possible:

```json
{"type":"error","message":"Microphone permission was denied."}
```

Toby should treat helper errors as user-facing operational errors, not crashes.
The UI can show the message and keep enough state for the user to retry,
discard, or quit.

## Testing

Test the TypeScript boundary without invoking native APIs:

- Command registration.
- Helper path resolution.
- JSON-lines parsing.
- State transitions from helper events.
- Metadata and storage behavior.

Native helper tests can be added separately when the helper has enough logic to
justify them, but the main CLI test suite should not depend on macOS permission
prompts or real audio devices.

## Current helpers

### toby-audio-helper (streaming)

`toby listen` follows this pattern:

- `apps/cli/src/commands/listen.ts` registers the command and opens configure.
- `apps/cli/src/ui/configure/` owns the Listen section in the configuration UI (`listen-panes.tsx`, `use-listen-controller.ts`).
- `apps/cli/src/listen/session-controller.ts` owns recording folders and metadata.
- `apps/cli/src/listen/macos/audio-capture.ts` spawns and supervises the helper.
- `apps/audio-helper/` contains the Swift executable.

See [listen.md](listen.md) for the command-specific recording behavior and audio
protocol details.

### toby-macos-helper (request/response)

The `macos` integration follows this pattern:

- `packages/core/src/integrations/macos/system-helper.ts` resolves the helper path, spawns it, and provides typed wrapper functions for all commands.
- `packages/core/src/integrations/macos/client.ts` calls typed wrappers and adapts results to the existing tool interface.
- `packages/core/src/integrations/macos/tools.ts` defines AI tools that call client functions.
- `packages/core/src/integrations/macos/index.ts` registers the integration and probes the helper on connect.
- `apps/macos-helper/` contains the Swift executable with 10 command domains.

See [macos-integration.md](macos-integration.md) for the full tool surface and capabilities.
