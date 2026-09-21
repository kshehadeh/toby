---
sidebar_position: 1
title: AI providers overview
---

# AI providers overview

Toby uses a large language model for chat, summarization, organization, and background schedules. You configure **one or more AI providers** in **Toby.app → Settings → AI**, then pick a provider and model per [persona](../personas).

Toby supports five AI providers:

| Provider | Best for |
| -------- | -------- |
| <img class="ai-provider-icon-inline" src="/img/ai-providers/openai.png" alt="" width="20" height="20" /> [OpenAI (direct)](./openai) | A single OpenAI API key and familiar model ids (`gpt-5-mini`, `gpt-4.1`, …) |
| <img class="ai-provider-icon-inline" src="/img/ai-providers/vercel.png" alt="" width="20" height="20" /> [Vercel AI Gateway](./vercel-ai-gateway) | One API key that routes to OpenAI, Anthropic, Google, Amazon, and more via `provider/model` slugs |
| <img class="ai-provider-icon-inline" src="/img/ai-providers/chutes.png" alt="" width="20" height="20" /> [Chutes](./chutes) | Open-source TEE-backed models (DeepSeek, Qwen, GLM, Kimi) via Chutes' OpenAI-compatible endpoint |
| <img class="ai-provider-icon-inline" src="/img/ai-providers/openrouter.png" alt="" width="20" height="20" /> [OpenRouter](./openrouter) | Hundreds of models from many vendors through a single OpenRouter API key |
| <img class="ai-provider-icon-inline" src="/img/ai-providers/ollama.png" alt="" width="20" height="20" /> [Ollama](./ollama) | Run open-source models locally on your machine (no API key needed) |

You only need **one** provider configured to start chatting. **New installs can connect OpenRouter in their browser without copying a key** (guided setup on the Home checklist). Use OpenAI direct for a single-vendor key, Chutes or OpenRouter for open-source catalogs, or Ollama for fully local inference.

## Quick setup

**Recommended:** Home onboarding → **Configure AI provider → Connect** opens **Set up Toby**:

1. **Welcome:** learn why Toby needs an AI connection. If you already have a key, skip straight to connecting.
2. **Account:** use the recommended **[OpenRouter](./openrouter)** browser sign-in, or choose **[Vercel AI Gateway](./vercel-ai-gateway)** for key-based setup. Review pricing before connecting.
3. **Connect:** choose **Connect OpenRouter**, sign in or create an account, and approve access in your browser. Toby automatically tests the connection. For manual setup, choose **Paste an existing key instead**, then **Connect and test**. The short test may use a small amount of credit; no personal context is sent.
4. **Ready:** see the test response. Toby saves your key securely and selects a model for the built-in Toby persona.

**Set up later** keeps your step and provider for next time. Pending browser sign-in is cancelled when you close the wizard. Unsaved keys are not
kept after closing the wizard. If the model cannot answer, Toby shows a recovery
message and leaves your existing connection unchanged.

Or open **Toby.app → Settings**:

1. Open **AI** and enter credentials for at least one provider ([Vercel AI Gateway](./vercel-ai-gateway#get-an-api-key), [OpenAI](./openai#get-an-api-key), [Chutes](./chutes#get-an-api-key), [OpenRouter](./openrouter#get-an-api-key), or an Ollama base URL).
2. Open **Personas**, choose **AI Provider** and **Model** (the guided Vercel flow configures the built-in **Toby** persona for you).

Credentials are stored in `~/.toby/credentials.json` on your Mac (encrypted at rest; see [Configuration overview](../configuration/overview)).

## Choosing a provider

| If you want… | Consider |
| ------------ | -------- |
| Easiest account connection, without copying keys | **OpenRouter** browser sign-in |
| Vercel-backed web search and multi-vendor models | **Vercel AI Gateway** |
| The simplest path with OpenAI models only | **OpenAI (direct)** |
| Open-source TEE-backed models with privacy guarantees | **Chutes** |
| The widest selection of models from many vendors | **OpenRouter** |
| Fully local, private inference with no API costs | **Ollama** |
| The same model on either path | Gateway slug `openai/gpt-5-mini` ≈ direct id `gpt-5-mini` |

Model ids differ by provider:

- **OpenAI (direct)** — bare ids, e.g. `gpt-5-mini`
- **Vercel AI Gateway** — `provider/model` slugs, e.g. `anthropic/claude-sonnet-4.6`
- **Chutes** — slash-delimited ids, e.g. `deepseek-ai/DeepSeek-V3.2-TEE`
- **OpenRouter** — slash-delimited ids, e.g. `openai/gpt-5.6-luna`
- **Ollama** — local model names, e.g. `llama3.2`

After you add credentials, persona and Settings model menus load an **up-to-date list** from that provider. Chutes and OpenRouter expose a **public model catalog**, so their model lists are fetched live even before you configure an API key. Until a provider is configured or its catalog is reachable, Toby shows a short curated default list.

## Context window display

In chat, Toby may show context usage as `ctx N%` when it knows the selected model family’s context window. The estimate supports common OpenAI and gateway-routed model families, including Anthropic, Gemini, Nova, Llama, Mistral, DeepSeek, Grok, GLM, and Kimi models.

## Context compaction

When a long chat approaches the model’s context limit, Toby can **automatically compact** the model’s history so the next turn still fits. It prefers cheap reclaim first: clamp runaway blobs, drop superseded re-reads of the same resource, then blank older tool dumps while keeping recent results. Your messages stay intact; the assistant can re-fetch tools if needed. The visible chat transcript is not rewritten. Compaction may briefly reduce prompt-cache reuse for that session after a rewrite.

## Auxiliary models

Pretreatment, planning, and other lightweight LLM steps use a smaller **auxiliary** model tied to the active persona’s provider:

- OpenAI direct: `gpt-4.1-nano` by default
- Vercel AI Gateway: `openai/gpt-4.1-nano` by default
- Chutes: `deepseek-ai/DeepSeek-V3.2-TEE` by default
- OpenRouter: `openai/gpt-5.6-luna` by default
- Ollama: `llama3.2` by default

Override with `TOBY_PRETREAT_MODEL` (bare id for OpenAI, or a full provider-specific model id). Set `TOBY_PRETREAT_DELTA=0` to disable follow-up delta pretreatment.

## Default integration providers

Separate from AI: in **Toby.app → Settings → Default Providers**, you pick which connected integration Toby prefers per category (email, calendar, tasks, and so on). That is unrelated to which LLM vendor you use. See [Default providers](../configuration/default-providers).

## Related topics

- [Set up your AI](../getting-started/setup-ai) — first-time configure walkthrough
- [OpenAI (direct)](./openai) — single OpenAI API key
- [Vercel AI Gateway](./vercel-ai-gateway) — one key, many vendors
- [Chutes](./chutes) — open-source TEE-backed models
- [OpenRouter](./openrouter) — hundreds of models from many vendors
- [Personas](../personas) — per-persona provider and model
- [Your first chat](../getting-started/first-chat)
