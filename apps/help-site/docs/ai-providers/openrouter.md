---
sidebar_position: 5
title: OpenRouter
---

# <span class="ai-provider-title"><img class="ai-provider-icon" src="/img/ai-providers/openrouter.png" alt="" width="40" height="40" />OpenRouter</span>

[OpenRouter](https://openrouter.ai/) is a unified API gateway that provides access to hundreds of AI models from leading providers like OpenAI, Anthropic, Google, Meta, Mistral, DeepSeek, xAI, and more. One API key gives you access to the full catalog.

Personas that use the **openrouter** provider send requests to `https://openrouter.ai/api/v1` with **slash-delimited model ids**, for example `openai/gpt-5.6-luna` or `anthropic/claude-sonnet-4.6`.

## Get an API key

**Easiest path:** use Toby’s guided setup (Home onboarding **Connect → OpenRouter**, or **Settings → AI → OpenRouter → Guided setup**). The wizard opens OpenRouter and the [Keys](https://openrouter.ai/keys) page, then validates and saves your key.

Manual steps:

1. Sign in at [openrouter.ai](https://openrouter.ai/).
2. Open **Keys** (or go to [openrouter.ai/keys](https://openrouter.ai/keys)).
3. Create a new API key and copy it.

Store the key in Toby, not in shell profiles or committed files.

## Configure in Toby

1. **Guided setup:** Home checklist → **Configure AI provider → Connect → OpenRouter**, or **Settings → AI → OpenRouter → Guided setup**. Toby validates the key and sets the built-in **Toby** persona to `openrouter` / `openai/gpt-5.6-luna`.
2. **Manual:** **Settings → AI → OpenRouter → API Key**, paste your key, then set a persona’s **AI Provider** to `openrouter`.

Toby writes the key to `~/.toby/credentials.json`.

You can also set **`OPENROUTER_API_KEY`** in your environment instead of storing a key in credentials.

For any persona, set **AI Provider** to `openrouter`, then pick a model from the list or enter a custom model id.

## Transcription (speech-to-text)

OpenRouter also supports [speech-to-text](https://openrouter.ai/docs/guides/overview/multimodal/stt). In Toby, open **Settings → Transcription**, choose **OpenRouter** as the provider, and pick an STT model. The model list is loaded from OpenRouter’s catalog (`output_modalities=transcription`) and reuses your OpenRouter chat API key when no dedicated transcription key is set.

See [Transcription](../configuration/transcription) for setup details.

## Model catalog

OpenRouter exposes a **public model catalog** at `GET /v1/models`. Toby fetches the live list automatically, even before you configure an API key, so you can browse available models in the persona editor without signing up first.

The catalog includes model names, context window sizes, pricing, and supported features. If the catalog cannot be reached, Toby falls back to a curated default list.

## Recommended models

OpenRouter offers hundreds of models. These are popular choices for Toby's chat, tool use, summarization, and schedules.

### Everyday chat

| Model | Role |
| ----- | ---- |
| `openai/gpt-5.6-luna` | Fast, cost-efficient OpenAI model for high-volume chat. Default auxiliary model for OpenRouter. |
| `openai/gpt-5.6-terra` | Balanced OpenAI model for everyday coding and reasoning. |
| `anthropic/claude-sonnet-4.6` | Strong all-rounder with long context and careful tool use. |
| `google/gemini-3-flash` | Fast Google option for quick turns. |

### Higher quality

| Model | Role |
| ----- | ---- |
| `openai/gpt-5.6-sol` | Flagship OpenAI model for complex reasoning and agentic workflows. |
| `anthropic/claude-haiku-4.5` | Fast Anthropic model for triage-style work. |
| `google/gemini-3-pro` | Heavier Google model for complex requests. |

### Open-weight models

| Model | Role |
| ----- | ---- |
| `meta-llama/llama-4-maverick` | Meta's larger Llama 4 variant for general-purpose work. |
| `deepseek/deepseek-v3.2` | Cost-effective reasoning-oriented open-weight model. |
| `xai/grok-4` | xAI model for experiments or comparison. |

Use **Custom model** in the persona editor for any model [listed on OpenRouter](https://openrouter.ai/models) that Toby does not show in the picker.

## App attribution

Toby sends optional app attribution headers on OpenRouter requests:

| Header | Default |
| ------ | ------- |
| `HTTP-Referer` | `https://github.com/kshehadeh/toby` |
| `X-Title` | `Toby` |

Override with `TOBY_AI_GATEWAY_REFERER` / `AI_GATEWAY_HTTP_REFERER` or `TOBY_AI_GATEWAY_APP_TITLE` / `AI_GATEWAY_X_TITLE`.

## Environment variables

| Variable | Purpose |
| -------- | ------- |
| `OPENROUTER_API_KEY` | API key instead of configure-stored credentials |
| `TOBY_PRETREAT_MODEL` | Override the pretreatment model (e.g. `openai/gpt-5.6-luna`) |
| `TOBY_PRETREAT_DELTA` | Set to `0` to disable follow-up delta pretreatment |

## See also

- [AI providers overview](./overview)
- [Chutes](./chutes) — another open-source model provider
- [Personas](../personas)
