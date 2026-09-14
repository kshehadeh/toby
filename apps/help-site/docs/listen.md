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

While a recording is in progress, open **Recordings** in the sidebar and select
the in-progress row to see live capture details and use **Stop Recording**
there—the same stop action as the toolbar button and menu bar. Starting a
recording while you are already in Recordings selects that take.

By default Toby records **both** your microphone and system audio (other apps
such as meetings). You can turn either source off under
**Settings → Transcription** (**Record microphone** / **Record system audio**).

When you stop and save:

1. Capture stops immediately. Long recordings then take a while to **prepare
   final audio** (especially when both mic and system tracks were captured).
   Toby shows a **processing** state — not the red live-recording indicator —
   on the toolbar, sidebar, menu bar, Dock, and Recordings window. Pressing
   Stop or Record again during this step does nothing; wait for the
   “Processing recording” toast to finish.
2. Source tracks (`mic.wav` / `system.wav`) and a `combined.m4a` file are written
   under the recordings folder. If both sources were captured, combined is
   **stereo dual-mono** (left = your mic, right = system audio)—not a mix that
   stacks both onto one channel (that causes echo from headphone bleed). Raw
   tracks are always kept.
3. Toby requests transcription through the local service when a model is configured.
4. Once transcription succeeds, Toby **deletes the recording's audio files** by
   default (**Delete audio after transcription**, under **Settings →
   Transcription**). The recording entry, transcript, and any summary are kept;
   audio is kept instead when transcription fails or the setting is off. You
   can also delete just the audio at any time with **Delete Audio** in the
   Recordings toolbar (disabled when the recording has no audio). A recording
   without audio cannot be re-transcribed.
5. The result appears in the **Recordings** window (transcript, summary, delete).
   Opening a long recording shows the window title and date subtitle immediately;
   the transcript, summary, and player fill in after a short skeleton so the window
   stays responsive. Use **Edit Recording** to rename the take, inspect metadata,
   and play audio. The player defaults to **System** (clean meeting audio) and
   can switch to **Mic** or **Both (L/R)** when available. Summary and transcript
   are separate tabs. When the transcription model returns timed segments, the
   transcript tab shows **start timestamps** on each line (for example `[0:12] …`);
   **Copy transcript** includes those times.

## Summarize a recording

After a recording is transcribed, open it in **Recordings** and use **Summarize**
(or **Re-Summarize** if a summary already exists) in the toolbar, or the
**Summarize** link on the Summary tab when no summary exists yet. Toby generates
a concise markdown summary with the persona you choose under **Settings →
Transcription → Persona for recording summaries** (or your default persona). The
summary is stored with the recording and shown on the Summary tab.

You can still start a chat about a recording for deeper Q&A.

## Retry transcription

If a recording failed to transcribe or you changed your transcription settings:

1. Open **Recordings** in the sidebar.
2. Select the recording.
3. Use **Transcribe** / **Re-Transcribe** in the Recordings toolbar (or ask in chat to re-transcribe that recording).

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
