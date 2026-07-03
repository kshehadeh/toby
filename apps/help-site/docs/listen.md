---
sidebar_position: 9
title: Listen mode
---

# Listen mode

`toby listen` opens a foreground recorder for microphone and/or system audio. Recordings are saved under `~/.toby/listen/recordings/<recording-id>/` by default with audio, metadata, and transcript files.

## Commands

```bash
toby listen
toby listen --mic-only
toby listen --system-only
toby listen --out-dir ./recordings
toby listen transcribe ~/.toby/listen/recordings/<recording-id>
```

## UI layout

The listen UI has two panes:

- **Left pane** — recent recordings plus **Start new recording**.
- **Right pane** — source toggles, live recording controls, or saved recording details.

Keyboard shortcuts:

| Shortcut | Action |
| -------- | ------ |
| `↑` / `↓` | Move within the focused pane |
| `Tab` | Switch panes |
| `Enter` | Select, toggle, edit, or run the focused action |
| `s` | Stop and save while recording |
| `d` | Stop and discard while recording |
| `Esc` | Return focus to the left pane |
| `q` | Quit, confirming discard if needed |

Saved recordings can be renamed, described, opened in Finder, deleted, or retranscribed.

## Recording in chat

In Toby.app, use the recording controls in the chat window to start and stop recording. `/stop-listening` saves and transcribes the audio, then adds the transcript as context so you can ask Toby to summarize the conversation or extract action items.

In the terminal chat TUI, use:

```text
/listen
/stop-listening
```

`/listen` starts recording in the current chat session. `/stop-listening` saves and transcribes the audio, then adds the transcript as context.

## macOS helper and permissions

Audio capture is currently macOS-only and is handled by the native **Toby.app**. The native app provides recording controls directly, and the CLI launches Toby.app and routes recording through its native localhost server (`~/.toby/native-port`).

Depending on selected sources, macOS may request Microphone, Screen/System Audio Recording, and Speech Recognition permissions.
