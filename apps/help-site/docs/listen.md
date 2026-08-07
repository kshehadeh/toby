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

By default Toby records **both** your microphone and system audio (other apps
such as meetings). You can turn either source off under
**Settings → Transcription** (**Record microphone** / **Record system audio**).

When you stop and save:

1. Source tracks (`mic.wav` / `system.wav`) and a `combined.m4a` file are written
   under the recordings folder. If both sources were captured, combined is
   **stereo dual-mono** (left = your mic, right = system audio)—not a mix that
   stacks both onto one channel (that causes echo from headphone bleed). Raw
   tracks are always kept.
2. Toby requests transcription through the local service when a model is configured.
3. The result appears in the **Recordings** window (playback, transcript, delete).
   The player defaults to **System** (clean meeting audio) and can switch to
   **Mic** or **Both (L/R)** when available. When the transcription model
   returns timed segments, the transcript view shows **start timestamps** on
   each line (for example `[0:12] …`); **Copy transcript** includes those times.

## Summarize a recording

After a recording is transcribed, open it in **Recordings** and use **Summarize**
(or **Re-Summarize** if a summary already exists). Toby generates a concise
markdown summary with the persona you choose under **Settings → Transcription →
Persona for recording summaries** (or your default persona). The summary appears
above the transcript and is stored with the recording.

You can still start a chat about a recording for deeper Q&A.

## Retry transcription

If a recording failed to transcribe or you changed your transcription settings:

1. Open **Recordings** in the sidebar.
2. Select the recording.
3. Use the transcription / retry control in the recording detail (or ask in chat to re-transcribe that recording).

Re-transcribing clears any existing summary so it cannot outlive a new transcript.
Run **Summarize** again after re-transcription if you still want a summary.

## Permissions

Depending on selected sources, macOS may request Microphone, Screen/System Audio
Recording, and related permissions for **Toby.app**.

## Transcription settings

Provider, model, and API key for speech-to-text are under **Settings → Transcription**,
along with the persona used for recording summaries.
See [Transcription](./configuration/transcription).

## Related

- [Transcription](./configuration/transcription)
- [Personas](./personas)
- [Toby.app](./toby-app)
