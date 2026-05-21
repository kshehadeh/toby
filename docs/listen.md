# Listen mode

`toby listen` is a foreground recording mode for collecting local audio and
saving it for later processing. It is intentionally not an integration
capability: it owns its own UI and recording lifecycle.

## Current scope

- macOS-only capture adapter.
- Record microphone, system audio, or both.
- Save source tracks separately as PCM `wav` files when the helper is present.
- Generate `combined.m4a` after listening stops for playback/transcription.
- Write `metadata.json` next to each recording.
- No transcription yet.

Recordings are stored under `~/.toby/listen/recordings/<recording-id>/` by
default. Pass `--out-dir <path>` to store recording folders elsewhere.

## Command

```bash
toby listen
toby listen --mic-only
toby listen --system-only
toby listen --helper /path/to/toby-audio-helper
```

The UI uses:

- `Enter` to run the selected action.
- `s` to stop and save while listening.
- `d` to stop and discard while listening.
- `Enter` on a saved recording to open its detail view.
- In the detail view, `Enter` on Name or Description opens an editor.
- In the detail view, `Enter` on "Open folder in Finder" opens the folder.
- In the detail view, `Enter` on "Delete recording" deletes after confirmation.
- `q` to close, confirming discard if a recording is active.

Saved recordings appear below the listener actions. The list is sorted newest
first and scrolls with the normal arrow keys.

Each recording's `metadata.json` can include optional `name` and `description`
fields. The listen UI edits those fields in place.

## Helper boundary

Node/Bun does not provide direct access to macOS audio capture APIs, so Toby
uses a small native Swift helper.

The general helper pattern is documented in
[native-helpers.md](native-helpers.md). This section describes the
`toby listen` helper's command-specific protocol.

Build it from the repo root:

```bash
bun run build:audio-helper
```

In development, Toby auto-detects the release build at
`helpers/toby-audio-helper/.build/release/toby-audio-helper` when launched from
the repo root. You can also set `TOBY_AUDIO_HELPER=/path/to/toby-audio-helper`
or pass `--helper`.

The helper command shape is:

```bash
toby-audio-helper record --out-dir <dir> --format wav [--mic] [--system]
```

The helper should write JSON lines to stdout:

```json
{"type":"permission","service":"microphone","status":"prompting"}
{"type":"permission","service":"microphone","status":"granted"}
{"type":"ready","helperVersion":"0.1.0","files":{"mic":"mic.wav","system":"system.wav"}}
{"type":"status","message":"recording"}
{"type":"stopped","durationMs":12000,"files":{"mic":"mic.wav","system":"system.wav","combined":"combined.m4a"}}
```

Toby sends one JSON line on stdin to stop:

```json
{"type":"stop","action":"save"}
```

or:

```json
{"type":"stop","action":"discard"}
```

## macOS APIs

- Microphone input: use `AVFoundation` (`AVAudioEngine` or
  `AVAudioRecorder`). This requires Microphone permission.
- System output audio: use `ScreenCaptureKit` audio capture. On current macOS
  versions this is tied to Screen Recording or System Audio Recording
  permission, depending on OS version.
- Write separate source tracks first, then export a generated `combined.m4a`
  after recording stops. The source files remain the debugging/source-of-truth
  artifacts if one stream fails or needs reprocessing.

## Transcription

macOS has the Speech framework (`SFSpeechRecognizer`), but it requires Speech
Recognition permission and may use Apple services unless on-device recognition
is available and requested. There is no simple built-in CLI transcription tool.

Future processing can sit behind a listen processor interface and support Apple
Speech, Whisper, or another provider.
