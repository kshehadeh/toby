---
sidebar_position: 3
title: Vercel AI Gateway
---

# Vercel AI Gateway

[Vercel AI Gateway](https://vercel.com/docs/ai-gateway) routes Toby’s requests to many upstream providers (OpenAI, Anthropic, Google, Amazon Bedrock, Meta, Mistral, DeepSeek, xAI, and more) through **one API** and **one key**.

Personas that use the **vercel** provider must use **gateway model slugs** in `provider/model` form, for example `openai/gpt-5-mini` or `anthropic/claude-sonnet-4.6`.

## Get an API key

1. Sign in to the [Vercel dashboard](https://vercel.com/).
2. Open your team’s **AI Gateway** settings (see [Authentication](https://vercel.com/docs/ai-gateway#authentication) in Vercel’s docs).
3. Create an **API key** and copy it.

Alternatively, for local development on a linked Vercel project:

- Run `vercel env pull` to provision **`VERCEL_OIDC_TOKEN`** so Toby can authenticate without a static key (see [Vercel OIDC](https://vercel.com/docs/ai-gateway#authentication)).

You can also set **`AI_GATEWAY_API_KEY`** in your environment instead of storing a key in `~/.toby/credentials.json`.

## Configure in Toby

```bash
toby config
```

1. Go to **AI → Vercel AI Gateway → API Key** and paste your key, **or** rely on `AI_GATEWAY_API_KEY` / `VERCEL_OIDC_TOKEN`.
2. For a persona, set **AI Provider** to `vercel`.
3. Pick a model from the list or enter a **Custom model slug** (any slug your gateway account exposes).

Toby validates slugs as `provider/model` (for example `google/gemini-3-flash`).

## Recommended models

The configure UI lists slugs Toby tests against regularly. These work well for Toby’s chat, tool use, summarization, and schedules.

### Everyday chat (recommended defaults)

| Slug | Role |
| ---- | ---- |
| `openai/gpt-5-mini` | **Best default** on the gateway—same family as the built-in Toby persona’s OpenAI direct default. |
| `openai/gpt-4.1-nano` | Default **pretreatment** model on the vercel provider. |
| `openai/gpt-4.1-mini` | Used for planning and other explicit auxiliary calls. |
| `anthropic/claude-sonnet-4.6` | Strong all-rounder if you prefer Anthropic for long context and careful tool use. |
| `google/gemini-3-flash` | Fast Google option for quick turns and high-volume schedules. |

### Faster or lower cost

| Slug | Role |
| ---- | ---- |
| `openai/gpt-5-nano` | Lightest OpenAI tier on the gateway. |
| `anthropic/claude-haiku-4.5` | Fast Anthropic model for triage-style work. |
| `google/gemini-2.5-flash` | Previous-generation flash model; still useful where available. |
| `amazon/nova-lite` | Inexpensive option on Bedrock-backed routes. |

### Higher quality

| Slug | Role |
| ---- | ---- |
| `openai/gpt-5.4` | Top-tier OpenAI via gateway when quality matters more than cost. |
| `anthropic/claude-opus-4.6` | Highest-capability Anthropic tier for difficult drafting or analysis. |
| `google/gemini-2.5-pro` | Heavier Google model for complex requests. |
| `mistral/mistral-medium` | Solid European-hosted option when it fits your policy needs. |

### Reasoning and alternatives

| Slug | Role |
| ---- | ---- |
| `deepseek/deepseek-v3.2` | Cost-effective reasoning-oriented model where enabled on your gateway. |
| `xai/grok-4-fast-reasoning` | xAI reasoning route for experiments or comparison. |
| `meta/llama-4-scout` | Open-weight style routing when you want Meta’s scout tier. |

Start with **`openai/gpt-5-mini`** unless you have a reason to prefer another vendor. Use **Custom model slug** for any model [listed in your gateway](https://vercel.com/docs/ai-gateway/models-and-providers) that Toby does not yet show in the picker.

## Automatic caching

Toby enables [Vercel automatic caching](https://vercel.com/docs/ai-gateway/models-and-providers/automatic-caching) on gateway requests (`gateway.caching: auto`) and adds provider-specific hints (for example OpenAI `promptCacheKey` and Anthropic ephemeral cache markers) so repeated system prompts cost less when the upstream supports it.

## App attribution

Toby sends optional [app attribution](https://vercel.com/docs/ai-gateway/ecosystem/app-attribution) headers on gateway requests so Vercel can list Toby on AI Gateway ecosystem pages:

| Header | Default |
| ------ | ------- |
| `http-referer` | `https://github.com/kshehadeh/toby` |
| `x-title` | `Toby` |

Override with:

| Variable | Purpose |
| -------- | ------- |
| `TOBY_AI_GATEWAY_REFERER` or `AI_GATEWAY_HTTP_REFERER` | Custom referer URL |
| `TOBY_AI_GATEWAY_APP_TITLE` or `AI_GATEWAY_X_TITLE` | Custom app title |
| `TOBY_PRETREAT_MODEL` | Pretreatment model (full slug, e.g. `openai/gpt-4.1-nano`) |
| `TOBY_PRETREAT_DELTA` | Set to `0` to disable follow-up delta pretreatment |
| `AI_GATEWAY_API_KEY` | API key instead of configure-stored credentials |

## Switching from OpenAI direct

If a persona used `gpt-5-mini` on OpenAI direct, set the vercel provider and model to **`openai/gpt-5-mini`**—the suffix matches; only the provider and slug format change. Toby can also normalize model ids when you change provider in configure.

## See also

- [OpenAI (direct)](./openai)
- [AI providers overview](./overview)
- [Personas](../personas)
