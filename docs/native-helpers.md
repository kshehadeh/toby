# Native helpers

Native helpers are small platform-specific executables that Toby can spawn when
Node/Bun is not the right boundary for talking to the operating system.

The first helper is the macOS audio helper used by `toby listen`:

```text
helpers/toby-audio-helper/
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

For `toby listen`, this means:

- The CLI command, Ink UI, recording list, metadata, confirmation prompts, and
  storage policy live in TypeScript.
- The Swift helper handles microphone capture, system audio capture, macOS
  permissions, audio file writing, and combined audio export.
- The helper reports progress through a line-delimited JSON protocol.
- Toby sends a small JSON command over stdin when the recording should stop.

This keeps the user-facing flow testable in TypeScript while isolating the code
that must use native macOS APIs.

## Process boundary

Helpers should be spawned as child processes and communicate over stdin/stdout.
Prefer a JSON-lines protocol:

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
    "build:audio-helper": "swift build -c release --package-path helpers/toby-audio-helper"
  }
}
```

Ignore generated build output in `.gitignore`.

## Resolution

TypeScript should resolve helpers in this order:

1. An explicit command option, such as `--helper /path/to/helper`.
2. An environment variable, such as `TOBY_AUDIO_HELPER`.
3. A packaged sibling beside the compiled Toby binary, such as `toby-listener`.
4. The development build path under `helpers/<helper-name>/.build/release/`.

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

## Current example

`toby listen` follows this pattern:

- `src/commands/listen.ts` registers the command.
- `src/ui/listen/App.tsx` owns the Ink UI.
- `src/listen/session-controller.ts` owns recording folders and metadata.
- `src/listen/macos/audio-capture.ts` spawns and supervises the helper.
- `helpers/toby-audio-helper/` contains the Swift executable.

See [listen.md](listen.md) for the command-specific recording behavior and audio
protocol details.
