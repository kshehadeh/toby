# Native helpers

Native helpers are small platform-specific executables that Toby can spawn when
Node/Bun is not the right boundary for talking to the operating system.

**Not the same as installable plugins.** Full integrations that expose connect,
tools, and chat use the plugin argv contract in [`plugin-protocol.md`](plugin-protocol.md).
Helpers are thin bridges for discrete native calls while TypeScript keeps product
logic.

Audio capture used to be handled by a standalone **toby-audio-helper** helper. It
has been removed; `toby listen` now routes recording through the native
**Toby.app** API server so microphone and system audio permissions are tied to
Toby.app's stable bundle identity.

**Toby.app** runs a native API server for permission-gated operations that plugins
cannot perform as raw CLI binaries (EventKit, Accessibility, microphone, and
system audio). See the Toby.app native API section below.

macOS system control (`macos` integration) is an **installable TypeScript plugin**
(`toby-plugin-macos`) that delegates all native operations to Toby.app's native
API server — see [`macos-integration.md`](macos-integration.md).

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

### Streaming protocol (example pattern)

A long-running helper can use a **line-delimited JSON streaming** protocol:

- The CLI command, Ink UI, state machine, and storage policy live in TypeScript.
- The native helper handles platform APIs, permissions, and resource cleanup.
- The helper reports progress through a line-delimited JSON protocol.
- Toby sends a small JSON command over stdin when the session should stop.

Choose the streaming pattern when a helper manages a long-lived session with
progress events. For discrete system-control tools exposed to chat, prefer an
installable plugin that implements [`plugin-protocol.md`](plugin-protocol.md)
and delegates to Toby.app's native API server (see `toby-plugin-macos`).

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
    "build:<helper-name>": "swift build -c release --package-path helpers/<helper-name>"
  }
}
```

Ignore generated build output in `.gitignore`.

## Resolution

TypeScript should resolve helpers in this order:

1. An explicit command option, such as `--helper /path/to/helper`.
2. An environment variable, such as `TOBY_<HELPER>_HELPER`.
3. The packaged helper under `~/.toby/helpers/`.
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

### Audio capture (Toby.app native API)

`toby listen` routes recording through Toby.app's native API server:

- `apps/cli/src/commands/listen.ts` registers the command and opens configure.
- `apps/cli/src/ui/configure/` owns the Listen section in the configuration UI (`listen-panes.tsx`, `use-listen-controller.ts`).
- `apps/cli/src/listen/session-controller.ts` owns recording folders and metadata.
- `apps/cli/src/listen/macos/audio-capture.ts` discovers Toby.app and calls its native audio endpoints.
- `apps/toby-app/Sources/TobyApp/NativeAudioHandler.swift` performs AVFoundation/ScreenCaptureKit capture and combines source tracks.
- `apps/toby-app/Sources/TobyApp/NativeServer.swift` exposes the `/api/native/audio/*` endpoints.

See [listen.md](listen.md) for the command-specific recording behavior.

For macOS system tools, see [macos-integration.md](macos-integration.md) (`toby-plugin-macos`).

For web search (Brave Search API), see [web-search.md](web-search.md) (`toby-plugin-websearch`).

## Toby.app native API server

Toby.app (`apps/toby-app/`) is a SwiftUI macOS app with a proper bundle identity and `Info.plist`. When running, it starts a local HTTP server for native operations that require TCC permissions (EventKit, Accessibility, microphone, system audio, and all macOS system controls). Plugins discover this server via `~/.toby/native-port` and route native calls through it. The macOS plugin (`toby-plugin-macos`) delegates all operations to this server and auto-launches Toby.app when it is not running; Apple Calendar falls back to in-process EventKit/AppleScript when the app is unavailable.

The same server also exposes audio endpoints used internally by Toby.app. Audio
is not a plugin fallback path: the native app calls its own loopback server so
AVFoundation and ScreenCaptureKit capture remain owned by the app process and
bundle identity. Saved recordings then rejoin the daemon/core path for
transcription, listing, and deletion.

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
| `POST` | `/api/native/audio/combine` | Combine existing mic/system WAV files into `combined.m4a` |

### Plugin integration

Plugins use a `NativeHelperClient` that:

1. Reads `~/.toby/native-port` for the port number
2. Calls `/api/native/health` to confirm Toby.app is responsive
3. Routes the operation to Toby.app if available
4. Falls back to current behavior: Apple Calendar falls back to in-process EventKit + AppleScript; the macOS plugin auto-launches Toby.app in the background and waits for the server to become available

### Source

- `apps/toby-app/Sources/TobyApp/NativeAudioHandler.swift` — AVFoundation/ScreenCaptureKit capture and recording finalization
- `apps/toby-app/Sources/TobyApp/NativeAudioClient.swift` — Toby.app client for its native audio endpoints
- `apps/toby-app/Sources/TobyApp/RecordingsStore.swift` — daemon client state for recording list/detail/delete

- `apps/toby-app/Sources/TobyApp/NativeServer.swift` — HTTP server using Network.framework
- `apps/toby-app/Sources/TobyApp/NativeCalendarHandler.swift` — EventKit operations
- `apps/toby-app/Sources/TobyApp/NativeMacOSHandler.swift` — macOS system controls and Accessibility-gated operations (Wi-Fi, Bluetooth, audio, battery, display, clipboard, windows, shortcuts)
- `apps/plugin-applecalendar/Sources/TobyPluginAppleCalendarLib/NativeHelperClient.swift` — calendar plugin client
- `apps/plugin-macos/src/native-client.ts` — macOS plugin TypeScript client that forwards to Toby.app's native API
