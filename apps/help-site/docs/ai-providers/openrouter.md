---
sidebar_position: 5
title: OpenRouter
---

# OpenRouter

[OpenRouter](https://openrouter.ai/) is a unified API gateway that provides access to hundreds of AI models from leading providers like OpenAI, Anthropic, Google, Meta, Mistral, DeepSeek, xAI, and more. One API key gives you access to the full catalog.

Personas that use the **openrouter** provider send requests to `https://openrouter.ai/api/v1` with **slash-delimited model ids**, for example `openai/gpt-5.6-luna` or `anthropic/claude-sonnet-4.6`.

## Get an API key

1. Sign in at [openrouter.ai](https://openrouter.ai/).
2. Open **Keys** (or go to [openrouter.ai/keys](https://openrouter.ai/keys)).
3. Create a new API key and copy it.

Store the key in Toby, not in shell profiles or committed files.

## Configure in Toby

Open **Toby.app → Settings → AI → OpenRouter → API Key** and paste your key.

Toby writes it to `~/.toby/credentials.json`.

You can also set **`OPENROUTER_API_KEY`** in your environment instead of storing a key in credentials.

For a persona, set **AI Provider** to `openrouter`, then pick a model from the list or enter a custom model id.

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
