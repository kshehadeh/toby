---
sidebar_position: 4
title: Chutes
---

# Chutes

[Chutes](https://chutes.ai/) hosts leading open-source AI models with confidential compute (TEE) backing. Toby connects to Chutes via its OpenAI-compatible endpoint, so chat, streaming, tool calling, and structured outputs all work out of the box.

Personas that use the **chutes** provider send requests to `https://llm.chutes.ai/v1` with **slash-delimited model ids**, for example `deepseek-ai/DeepSeek-V3.2-TEE` or `Qwen/Qwen3-32B-TEE`.

## Get an API key

1. Sign in at [chutes.ai](https://chutes.ai/).
2. Open **Auth → Start** to create an API key (starts with `cpk_`).
3. Copy the key.

Store the key in Toby, not in shell profiles or committed files.

## Configure in Toby

Open **Toby.app → Settings → AI → Chutes → API Key** and paste your key.

Toby writes it to `~/.toby/credentials.json`.

You can also set **`CHUTES_API_KEY`** in your environment instead of storing a key in credentials.

For a persona, set **AI Provider** to `chutes`, then pick a model from the list or enter a custom model id.

## Model catalog

Chutes exposes a **public model catalog** at `GET /v1/models`. Toby fetches the live list automatically, even before you configure an API key, so you can browse available models in the persona editor without signing up first.

If the catalog cannot be reached, Toby falls back to a curated default list.

## Recommended models

These models are available on Chutes with TEE (confidential compute) backing. All report `confidential_compute=true`.

### Everyday chat

| Model | Role |
| ----- | ---- |
| `deepseek-ai/DeepSeek-V3.2-TEE` | Strong all-rounder for chat, reasoning, and tool use. Default auxiliary model for Chutes. |
| `Qwen/Qwen3-32B-TEE` | Cost-aware model good for tool loops and everyday chat. |
| `MiniMaxAI/MiniMax-M2.5-TEE` | Balanced cost and quality for agentic workflows. |

### Long context

| Model | Role |
| ----- | ---- |
| `zai-org/GLM-5.2-TEE` | 1M token context window for long-context work. |
| `zai-org/GLM-5.1-TEE` | 198K context for long documents. |
| `moonshotai/Kimi-K2.6-TEE` | 256K context with vision and video support. |

### Higher quality

| Model | Role |
| ----- | ---- |
| `Qwen/Qwen3.5-397B-A17B-TEE` | Large Qwen model for complex reasoning. |
| `Qwen/Qwen3-235B-A22B-Thinking-2507-TEE` | Thinking variant for multi-step reasoning. |

## Environment variables

| Variable | Purpose |
| -------- | ------- |
| `CHUTES_API_KEY` | API key instead of configure-stored credentials |
| `TOBY_PRETREAT_MODEL` | Override the pretreatment model (e.g. `deepseek-ai/DeepSeek-V3.2-TEE`) |
| `TOBY_PRETREAT_DELTA` | Set to `0` to disable follow-up delta pretreatment |

## See also

- [AI providers overview](./overview)
- [OpenRouter](./openrouter) — another multi-model provider
- [Personas](../personas)
