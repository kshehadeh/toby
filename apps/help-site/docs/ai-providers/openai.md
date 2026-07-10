---
sidebar_position: 2
title: OpenAI (direct)
---

# OpenAI (direct)

Connect Toby directly to the [OpenAI API](https://platform.openai.com/docs). Personas that use the **openai** provider send requests to OpenAI with **bare model ids** (no `provider/` prefix).

## Get an API key

1. Sign in at [platform.openai.com](https://platform.openai.com/).
2. Open **API keys** (under your organization settings).
3. Create a new secret key. Copy it immediately—OpenAI shows the full value only once.
4. Ensure your account has billing enabled and usage limits that fit your expected volume.

Store the key in Toby, not in shell profiles or committed files.

## Configure in Toby

Open **Toby.app → Settings → AI → OpenAI → API Token** and paste your API key.

Toby writes the token to `~/.toby/credentials.json`.

For a persona, set **AI Provider** to `openai` and choose a model from the list (or type a supported model id if you know it is available on your account).

## Recommended models

Once your OpenAI API key is configured, the model picker loads the **live catalog** from OpenAI (chat models). If the catalog cannot be reached, Toby falls back to the curated list below. All use **direct** ids (examples below).

### Everyday chat (recommended default)

| Model | Role |
| ----- | ---- |
| `gpt-5-mini` | **Default for the built-in Toby persona.** Strong balance of quality, speed, and cost for chat, summarization, and organization. |
| `gpt-4.1-mini` | Reliable fallback for planning and other auxiliary calls. |
| `gpt-4.1-nano` | Default **pretreatment** model when using OpenAI direct (fast classification). |

### Faster or lower cost

| Model | Role |
| ----- | ---- |
| `gpt-5-nano` | Lighter GPT-5 tier for quick triage or high-volume schedules. |
| `gpt-4.1-nano` | Cheapest GPT-4.1 family option for simple classification-style work. |
| `gpt-4o-mini` | Older but still capable small model if your account still lists it. |

### Higher quality or reasoning

| Model | Role |
| ----- | ---- |
| `gpt-5` | More capable GPT-5 tier when answers need extra depth. |
| `gpt-4.1` | Strong general model when you want quality without the GPT-5 line. |
| `gpt-4o` | Previous flagship multimodal model; still useful if you rely on it today. |
| `o3` | Reasoning-focused work (complex planning, multi-step analysis). |
| `o4-mini` | Lighter reasoning model when you want some “think longer” behavior at lower cost than `o3`. |

Start with **`gpt-5-mini`** for most personas. Move to **`gpt-5`** or **`o3`** when you notice quality limits; use **`gpt-5-nano`** for cron-style schedules that run often.

## Prompt caching

Toby sends a stable OpenAI `promptCacheKey` on chat turns so repeated system prompts can hit [OpenAI prompt caching](https://developers.openai.com/docs/guides/prompt-caching) when your model and account support it.

## Environment variables

| Variable | Purpose |
| -------- | ------- |
| `TOBY_PRETREAT_MODEL` | Override the pretreatment model (bare OpenAI id, e.g. `gpt-4.1-nano`) |
| `TOBY_PRETREAT_DELTA` | Set to `0` to disable follow-up delta pretreatment (default: enabled) |

OpenAI credentials are **not** read from `OPENAI_API_KEY` by Toby today—use **Settings → AI → OpenAI** in Toby.app (or restore a backup that includes `~/.toby/credentials.json`).

## See also

- [Vercel AI Gateway](./vercel-ai-gateway) — one key, many vendors
- [AI providers overview](./overview)
- [Personas](../personas)
