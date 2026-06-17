# Native helpers

Native helpers are small platform-specific executables that Toby can spawn when
Node/Bun is not the right boundary for talking to the operating system.

**Not the same as installable plugins.** Full integrations that expose connect,
tools, and chat use the plugin argv contract in [`plugin-protocol.md`](plugin-protocol.md).
Helpers are thin bridges for discrete native calls (Wi‑Fi status, audio capture)
while TypeScript keeps product logic.

One helper currently exists:

- **toby-audio-helper** — macOS audio capture for `toby listen` (line-delimited JSON streaming protocol)

In addition, **Toby.app** runs a native API server for permission-gated operations that plugins cannot perform as raw CLI binaries (EventKit, Accessibility). See the Toby.app native API section below.

macOS system control (`macos` integration) is an **installable plugin** (`toby-plugin-macos`) that calls native APIs in-process — see [`macos-integration.md`](macos-integration.md).

```text
apps/audio-helper/
  Package.swift
  Sources/TobyAudioHelper/main.swift
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
  permissions, audio file writing, combined audio export, and whisper.cpp
  transcription (orchestrating the bundled `whisper-cli` binary).
- The helper reports progress through a line-delimited JSON protocol.
- Toby sends a small JSON command over stdin when the recording should stop.

Choose the streaming pattern when the helper manages a long-lived session with
progress events. For discrete system-control tools exposed to chat, prefer an
installable plugin that implements [`plugin-protocol.md`](plugin-protocol.md)
and calls native code in-process (see `toby-plugin-macos`).

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
    "build:audio-helper": "swift build -c release --package-path apps/audio-helper"
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
protocol details. See [listen-binaries.md](listen-binaries.md) for how
`toby-listener` and `whisper-cli` are built and shipped in releases.

For macOS system tools, see [macos-integration.md](macos-integration.md) (`toby-plugin-macos`).

For web search (Brave Search API), see [web-search.md](web-search.md) (`toby-plugin-websearch`).

## Toby.app native API server

Toby.app (`apps/toby-app/`) is a SwiftUI macOS app with a proper bundle identity and `Info.plist`. When running, it starts a local HTTP server for native operations that require TCC permissions (EventKit, Accessibility). CLI plugins discover this server via `~/.toby/native-port` and route privileged calls through it, falling back to in-process or AppleScript when Toby.app is not running.

### Why this exists

macOS TCC ties permission grants to the calling binary's identity. Raw CLI plugin binaries show up with confusing names in System Settings, or get XPC errors from `calaccessd` when requesting EventKit access. By routing through Toby.app, users grant permissions once to a clearly-identified app.

### Protocol

The native server listens on a random localhost port written to `~/.toby/native-port`. All endpoints return JSON: `{"ok":true,"data":{...}}` or `{"ok":false,"error":"...","needsPermission":true}`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/native/health` | Check native server is alive |
| `POST` | `/api/native/calendar/request-access` | Prompt for Calendar permission |
| `POST` | `/api/native/calendar/list` | List calendars |
| `POST` | `/api/native/calendar/search` | Search events |
| `POST` | `/api/native/calendar/get` | Get event by uid |
| `POST` | `/api/native/calendar/create` | Create event |
| `POST` | `/api/native/calendar/update` | Update event |
| `POST` | `/api/native/calendar/delete` | Delete event |
| `POST` | `/api/native/macos/minimize-all` | Minimize all windows (Accessibility) |
| `POST` | `/api/native/macos/unminimize-all` | Unminimize all windows (Accessibility) |
| `POST` | `/api/native/macos/minimize-app` | Minimize app windows (Accessibility) |
| `POST` | `/api/native/macos/unminimize-app` | Unminimize app windows (Accessibility) |
| `GET` | `/api/native/macos/accessibility-status` | Check if Accessibility is granted |
| `GET` | `/api/native/audio/status` | Check active native audio recording state |
| `POST` | `/api/native/audio/start` | Start native microphone/system audio capture |
| `POST` | `/api/native/audio/stop` | Stop native audio capture and save recording files |

### Plugin integration

Plugins use a `NativeHelperClient` that:

1. Reads `~/.toby/native-port` for the port number
2. Calls `/api/native/health` to confirm Toby.app is responsive
3. Routes the operation to Toby.app if available
4. Falls back to current behavior (EventKit + AppleScript for calendar; in-process with permission error for macOS)

### Source

- `apps/toby-app/Sources/TobyApp/NativeServer.swift` — HTTP server using Network.framework
- `apps/toby-app/Sources/TobyApp/NativeCalendarHandler.swift` — EventKit operations
- `apps/toby-app/Sources/TobyApp/NativeMacOSHandler.swift` — Accessibility-gated operations
- `apps/plugin-applecalendar/Sources/TobyPluginAppleCalendarLib/NativeHelperClient.swift` — calendar plugin client
- `apps/plugin-macos/Sources/TobyPluginMacOSLib/System/NativeHelperClient.swift` — macOS plugin client
