---
sidebar_position: 5
title: Transcription
---

# Transcription

When you save a [Listen](../listen) recording, Toby can transcribe audio with a configured **transcription** provider. These settings are separate from your chat AI provider (though OpenAI can reuse the same API token).

Open **Toby.app → Settings → Transcription**.

## Settings

| Setting | Purpose |
| ------- | ------- |
| **Provider** | Transcription backend (for example OpenAI) |
| **Model** | Model id offered by that provider |
| **API Key** | Optional dedicated key for transcription |

### OpenAI

If the provider reuses OpenAI, you can leave the transcription API key empty and Toby will use **Settings → AI → OpenAI → API Token** when no transcription-specific key is set. The Settings UI shows a hint when that applies.

## When transcription runs

- After you **stop and save** a recording in Toby.app (or a capture path that finalizes into Listen storage)
- When you **retry / re-transcribe** a recording from the Recordings window or related tools
- Via the local service [Server API](../api/server-api) listen transcribe endpoint used by the app

Capture itself uses Toby.app’s [Native API](../api/native-api) (microphone / system audio). Listing and transcription use the daemon **Server API**.

## If transcription fails

1. Confirm **Provider**, **Model**, and key (or OpenAI AI token).
2. Open **Recordings**, select the recording, and retry transcription.
3. Check that the recording has playable audio (`combined.m4a` or source WAVs).

## Related

- [Listen mode](../listen)
- [Configuration overview](./overview)
- [OpenAI (direct)](../ai-providers/openai) — shared API token case
