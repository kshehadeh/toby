# Listen mode

`toby listen` opens **Configuration** focused on the **Listen** section. It is
not a separate integration capability: recording lifecycle and metadata live in
`apps/cli/src/listen/`, and the Ink UI is part of the configure tree (like Skills).

## Current scope

- macOS-only capture adapter.
- Record microphone, system audio, or both.
- Save source tracks separately as PCM `wav` files when the helper is present.
- Generate `combined.m4a` after listening stops for playback/transcription.
- Generate `transcript.txt` and `transcript.json` via an installed
  **transcription plugin** (default: `toby-plugin-whisper` / whisper.cpp) when
  saving succeeds.
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

## UI

Listen lives under **Configuration → Listen** (same pattern as Skills):

- **`toby listen`** opens config with Listen expanded and **Start new recording** selected.
- **`toby config`** → expand **Listen** to browse recordings or start a new one.
- **Start new recording** — action row at the top; the right pane shows mic/system source toggles.
- **Saved recordings** — one row per recording under Listen; the right pane shows metadata and actions.

Keyboard shortcuts (with Listen or a recording selected):

- `↑↓` navigate within the focused pane.
- `Tab` switches focus between the category tree and the detail pane (auto-focused on the detail pane while recording).
- `Enter` to select/toggle the focused item.
- `s` to stop and save while listening.
- `d` to stop and discard while listening.
- `Esc` moves focus back to the category tree from the detail pane.
- `q` to close, confirming discard if a recording is active.

The recording interface shows an animated red dot indicator, a bold "Recording" label, an elapsed timer, and two actions: a green bold "Stop and Save" (default) and a red bold "Stop and Discard".

In the recording detail view, `Enter` on Name or Description opens an editor, `Enter` on "Open folder in Finder" opens the folder, and `Enter` on "Delete recording" deletes after confirmation.

Each recording's `metadata.json` can include optional `name` and `description`
fields. The listen UI edits those fields in place.

Use `toby listen transcribe <recording-folder>` to retry transcription for an
existing saved recording. The command uses `metadata.files.combined` when it
points to an existing file, otherwise it falls back to `<recording-folder>/combined.m4a`.

## Chat slash commands

The chat TUI also exposes lightweight recording controls:

```text
/listen
/stop-listening
```

`/listen` starts recording microphone and system audio for the active chat session. `/stop-listening` stops and saves the recording, runs transcription, writes the same recording folder artifacts as `toby listen`, and injects the transcript as hidden user context so the assistant can summarize or reason about what was said. If transcription is unavailable, the saved audio path is still shown in chat.

These commands use the same helper discovery, macOS-only capture support, and permission requirements as the configure Listen section.

## Helper boundary

Node/Bun does not provide direct access to macOS audio capture APIs, so Toby
uses a small native Swift helper.

The general helper pattern is documented in
[native-helpers.md](native-helpers.md). This section describes the
`toby listen` helper's command-specific protocol.

Build and release details for `toby-listener` and `whisper-cli` are documented in
[listen-binaries.md](listen-binaries.md). For local development, build the listener from the repo root:

```bash
bun run build:audio-helper
```

In packaged installs, Toby auto-detects `toby-listener` under
`~/.toby/helpers/` (falling back to a sibling of the `toby` binary for
legacy installs). In development, Toby auto-detects the release build at
`apps/audio-helper/.build/release/toby-audio-helper` when launched from
the repo root. You can also set `TOBY_AUDIO_HELPER=/path/to/toby-audio-helper`
or pass `--helper`.

The helper command shape is:

```bash
toby-audio-helper record --out-dir <dir> --format wav [--mic] [--system]
toby-audio-helper combine --out-dir <dir> [--mic <path>] [--system <path>]
```

The helper should write JSON lines to stdout:

```json
{"type":"permission","service":"microphone","status":"prompting"}
{"type":"permission","service":"microphone","status":"granted"}
{"type":"ready","helperVersion":"0.1.0","files":{"mic":"mic.wav","system":"system.wav"}}
{"type":"status","message":"recording"}
{"type":"status","message":"combining audio"}
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

After the Swift helper combines audio into `combined.m4a`, Toby invokes the
configured **transcription plugin** (`doTranscription` tool). The default
plugin is **`toby-plugin-whisper`**, which uses whisper.cpp locally.

The plugin writes temp transcript files; Toby copies them into the recording
folder as:

- `transcript.txt` — readable transcript text.
- `transcript.json` — optional structured payload with text, segment timing,
  source audio path, timestamp, and locale.

### Setup

Release installs place `toby-plugin-whisper` under `~/.toby/plugins/` and run
plugin setup (whisper-cli + default model). Manual recovery:

```bash
toby plugins setup whisper
```

Choose the active provider under **Configuration → Listen → Transcription
provider**, or **Configuration → Settings → Transcription Provider**. Configure
whisper paths under **Configuration → Plugins → whisper**.

If transcription fails, Toby still saves the audio recording and records the
error in metadata. Retry with `toby listen transcribe <recording-folder>`.
