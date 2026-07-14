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
| **Provider** | Transcription backend (OpenAI, Groq, or Vercel AI Gateway) |
| **Model** | Model id offered by that provider |
| **API Key** | Optional dedicated key for transcription |
| **Persona for recording summaries** | Persona used when you summarize a recording transcript (falls back to the default persona) |

### OpenAI

If the provider reuses OpenAI, you can leave the transcription API key empty and Toby will use **Settings → AI → OpenAI → API Token** when no transcription-specific key is set. The Settings UI shows a hint when that applies.

### Vercel AI Gateway

The **Vercel AI Gateway** provider routes transcription requests through the same gateway key you use for chat. It reuses **Settings → AI → Vercel AI Gateway → API Key** (or `AI_GATEWAY_API_KEY` / `VERCEL_OIDC_TOKEN`) when no transcription-specific key is set.

Available models are fetched from the live gateway catalog (filtered to `type: transcription`). The curated fallback list includes:

| Slug | Upstream |
| ---- | -------- |
| `openai/whisper-1` | OpenAI Whisper |
| `openai/gpt-4o-mini-transcribe` | OpenAI GPT-4o mini transcribe |
| `openai/gpt-4o-transcribe` | OpenAI GPT-4o transcribe |
| `xai/grok-stt` | xAI Grok STT |

> **Note:** Gateway transcription is non-streaming and subject to the same audio payload limits as other providers (25 MB before chunking).

## When transcription runs

- After you **stop and save** a recording in Toby.app (or a capture path that finalizes into Listen storage)
- When you **retry / re-transcribe** a recording from the Recordings window or related tools
- Via the local service [Server API](../api/server-api) listen transcribe endpoint used by the app

Capture itself uses Toby.app’s [Native API](../api/native-api) (microphone / system audio). Listing and transcription use the daemon **Server API**.

## Recording summaries

Once a recording has a transcript, **Summarize** / **Re-Summarize** in the
Recordings inspector generates an AI summary using the persona selected here.
See [Listen mode](../listen).

## If transcription fails

1. Confirm **Provider**, **Model**, and key (or OpenAI AI token).
2. Open **Recordings**, select the recording, and retry transcription.
3. Check that the recording has playable audio (`combined.m4a` or source WAVs).

## Related

- [Listen mode](../listen)
- [Personas](../personas)
- [Configuration overview](./overview)
- [OpenAI (direct)](../ai-providers/openai) — shared API token case
