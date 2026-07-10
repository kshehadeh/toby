---
sidebar_position: 1
title: AI providers overview
---

# AI providers overview

Toby uses a large language model for chat, summarization, organization, and background schedules. You configure **one or more AI providers** in **Toby.app → Settings → AI**, then pick a provider and model per [persona](../personas).

Toby supports two AI providers today:

| Provider | Best for |
| -------- | -------- |
| [OpenAI (direct)](./openai) | A single OpenAI API key and familiar model ids (`gpt-5-mini`, `gpt-4.1`, …) |
| [Vercel AI Gateway](./vercel-ai-gateway) | One API key that routes to OpenAI, Anthropic, Google, Amazon, and more via `provider/model` slugs |

You only need **one** provider configured to start chatting. Many people use OpenAI direct for simplicity, or Vercel AI Gateway when they want multi-vendor models and unified billing through Vercel.

## Quick setup

Open **Toby.app → Settings** and configure:

1. Open **AI** and enter credentials for at least one provider ([OpenAI](./openai#get-an-api-key) or [Vercel AI Gateway](./vercel-ai-gateway#get-an-api-key)).
2. Open **Personas**, choose **AI Provider** and **Model** (or use the built-in **Toby** persona, which defaults to OpenAI `gpt-5-mini`).

Credentials are stored in `~/.toby/credentials.json` on your Mac.

## Choosing a provider

| If you want… | Consider |
| ------------ | -------- |
| The simplest path with OpenAI models only | **OpenAI (direct)** |
| Anthropic, Google, or other vendors without separate API accounts | **Vercel AI Gateway** |
| The same model on either path | Gateway slug `openai/gpt-5-mini` ≈ direct id `gpt-5-mini` |

Model ids differ by provider:

- **OpenAI (direct)** — bare ids, e.g. `gpt-5-mini`
- **Vercel AI Gateway** — `provider/model` slugs, e.g. `anthropic/claude-sonnet-4.6`
- **Ollama** — local model names, e.g. `llama3.2`

After you add credentials (or an Ollama base URL), persona and Settings model menus load an **up-to-date list** from that provider. Until a provider is configured, Toby shows a short curated default list.

## Context window display

In chat, Toby may show context usage as `ctx N%` when it knows the selected model family’s context window. The estimate supports common OpenAI and gateway-routed model families, including Anthropic, Gemini, Nova, Llama, Mistral, DeepSeek, Grok, GLM, and Kimi models.

## Auxiliary models

Pretreatment, planning, and other lightweight LLM steps use a smaller **auxiliary** model tied to the active persona’s provider:

- OpenAI direct: `gpt-4.1-nano` by default
- Vercel AI Gateway: `openai/gpt-4.1-nano` by default

Override with `TOBY_PRETREAT_MODEL` (bare id for OpenAI, or a full gateway slug such as `openai/gpt-4.1-nano`). Set `TOBY_PRETREAT_DELTA=0` to disable follow-up delta pretreatment.

## Default integration providers

Separate from AI: in **Toby.app → Settings → Default Providers**, you pick which connected integration Toby prefers per category (email, calendar, tasks, and so on). That is unrelated to which LLM vendor you use. See [Default providers](../configuration/default-providers).

## Related topics

- [Set up your AI](../getting-started/setup-ai) — first-time configure walkthrough
- [Personas](../personas) — per-persona provider and model
- [Your first chat](../getting-started/first-chat)
