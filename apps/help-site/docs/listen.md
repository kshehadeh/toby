---
sidebar_position: 9
title: Listen mode
---

# Listen mode

Toby records microphone and/or system audio on **macOS**, saves recordings under
`~/.toby/listen/recordings/<recording-id>/`, and can transcribe them with your
configured transcription provider.

## Record in Toby.app

Use **Record Audio** (or equivalent recording controls) in Toby.app. Capture runs
inside the app so Microphone and Screen/System Audio permissions stay tied to
Toby.app’s bundle identity.

When you stop and save:

1. Source tracks and preferably `combined.m4a` are written under the recordings folder.
2. Toby requests transcription through the daemon when a model is configured.
3. The result appears in the **Recordings** window (playback, transcript, delete).

Ask in chat to summarize a transcript or extract action items after recording.

## CLI

```bash
toby listen
toby listen transcribe ~/.toby/listen/recordings/<recording-id>
```

- `toby listen` opens native recording controls (routes through Toby.app).
- `toby listen transcribe <folder>` retries transcription for a saved recording.

## Permissions

Depending on selected sources, macOS may request Microphone, Screen/System Audio
Recording, and related permissions for **Toby.app**.

## Related

- [Toby.app](./toby-app)
- Source [listen architecture](https://github.com/kshehadeh/toby/blob/main/docs/listen.md)
