---
sidebar_position: 5
title: Transcription
---

# Transcription

When you save a [Listen](../listen) recording, Toby can transcribe audio with a configured **transcription** provider. These settings are separate from your chat AI provider (though OpenAI, Vercel AI Gateway, and OpenRouter can reuse the same API keys you set under **AI**).

Open **Toby.app → Settings → Transcription**.

## Settings

| Setting | Purpose |
| ------- | ------- |
| **Provider** | Transcription backend (OpenAI, Groq, Vercel AI Gateway, or OpenRouter) |
| **Model** | Model id offered by that provider |
| **API Key** | Optional dedicated key for transcription |
| **Persona for recording summaries** | Persona used when you summarize a recording transcript (falls back to the default persona) |
| **Record microphone** | Capture the mic during **Record Audio** (default on) |
| **Record system audio** | Capture other apps during **Record Audio** (default on) |

At least one of microphone or system audio must stay on. When both are recorded,
`combined.m4a` is dual-mono stereo (mic left, system right) rather than a summed
mix—so headphone bleed does not turn into an echo. See [Listen mode](../listen).

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

### OpenRouter

The **OpenRouter** provider uses OpenRouter’s speech-to-text API
([`/api/v1/audio/transcriptions`](https://openrouter.ai/docs/guides/overview/multimodal/stt)),
which is OpenAI-compatible. It reuses **Settings → AI → OpenRouter → API Key**
(or `OPENROUTER_API_KEY`) when no transcription-specific key is set.

Available models are loaded from the live OpenRouter catalog:

```text
GET https://openrouter.ai/api/v1/models?output_modalities=transcription
```

If the catalog is unreachable, Toby falls back to a curated list (Whisper,
GPT-4o transcribe variants, Voxtral Mini Transcribe, Deepgram Nova-3, and similar).

> **Note:** Multipart uploads are limited to 25 MB (same as other providers);
> Toby chunks larger recordings automatically when possible.

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
