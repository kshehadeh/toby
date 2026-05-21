# Listen mode

`toby listen` is a foreground recording mode for collecting local audio and
saving it for later processing. It is intentionally not an integration
capability: it owns its own UI and recording lifecycle.

## Current scope

- macOS-only capture adapter.
- Record microphone, system audio, or both.
- Save source tracks separately as PCM `wav` files when the helper is present.
- Generate `combined.m4a` after listening stops for playback/transcription.
- Generate `transcript.txt` and `transcript.json` with macOS Speech when saving
  succeeds.
- Write `metadata.json` next to each recording.

Recordings are stored under `~/.toby/listen/recordings/<recording-id>/` by
default. Pass `--out-dir <path>` to store recording folders elsewhere.

## Command

```bash
toby listen
toby listen --mic-only
toby listen --system-only
toby listen --helper /path/to/toby-listener
toby listen transcribe ~/.toby/listen/recordings/<recording-id>
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

Use `toby listen transcribe <recording-folder>` to retry transcription for an
existing saved recording. The command uses `metadata.files.combined` when it
points to an existing file, otherwise it falls back to `<recording-folder>/combined.m4a`.

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

In packaged installs, Toby auto-detects `toby-listener` beside the `toby`
binary. In development, Toby auto-detects the release build at
`helpers/toby-audio-helper/.build/release/toby-audio-helper` when launched from
the repo root. You can also set `TOBY_AUDIO_HELPER=/path/to/toby-audio-helper`
or pass `--helper`.

The helper command shape is:

```bash
toby-audio-helper record --out-dir <dir> --format wav [--mic] [--system]
toby-audio-helper transcribe --input <audio-file> --out-dir <dir>
```

The helper should write JSON lines to stdout:

```json
{"type":"permission","service":"microphone","status":"prompting"}
{"type":"permission","service":"microphone","status":"granted"}
{"type":"ready","helperVersion":"0.1.0","files":{"mic":"mic.wav","system":"system.wav"}}
{"type":"status","message":"recording"}
{"type":"status","message":"transcribing audio"}
{"type":"stopped","durationMs":12000,"files":{"mic":"mic.wav","system":"system.wav","combined":"combined.m4a","transcript":"transcript.txt","transcriptJson":"transcript.json"}}
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

Toby uses macOS Speech (`SFSpeechRecognizer`) to transcribe the generated
`combined.m4a`. This requires Speech Recognition permission and may use Apple
services. Successful transcription writes:

- `transcript.txt` — readable transcript text.
- `transcript.json` — structured transcript payload with text, segment timing,
  confidence, source audio path, timestamp, and locale.

If transcription fails, Toby still saves the audio recording and records the
helper error in metadata. Retry with `toby listen transcribe <recording-folder>`.
