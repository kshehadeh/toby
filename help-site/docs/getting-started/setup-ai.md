---
sidebar_position: 2
title: Set up your AI
---

# Set up your AI

Toby uses an LLM for chat, summarization, and organization. You need at least one AI provider configured before chatting.

## Open the configure UI

```bash
toby config
```

(`toby configure` is an alias for the same command.)

## OpenAI (direct)

Navigate to **AI → OpenAI → API Token** and enter your key. Toby stores credentials in `~/.toby/credentials.json` (not in your shell history).

Personas using the **openai** provider use bare model ids (for example `gpt-5-mini`).

## Vercel AI Gateway

[Vercel AI Gateway](https://vercel.com/docs/ai-gateway) routes requests to many providers (OpenAI, Anthropic, Google, Amazon Bedrock, and more) through one API.

1. Create an API key in the [Vercel dashboard](https://vercel.com/docs/ai-gateway#authentication) (AI Gateway settings).
2. In configure, open **AI → Vercel AI Gateway → API Key** and paste the key.
3. For a persona, set **AI Provider** to `vercel` and pick a model from the list or enter a **Custom model slug**.

Gateway models use **`provider/model`** format, for example:

- `openai/gpt-5-mini`
- `anthropic/claude-sonnet-4.6`
- `google/gemini-3-flash`

You can also set `AI_GATEWAY_API_KEY` in your environment instead of storing a key in credentials.

Toby sends optional [app attribution](https://vercel.com/docs/ai-gateway/ecosystem/app-attribution) headers on gateway requests (`http-referer`, `x-title`) so Vercel can list Toby on AI Gateway pages. Defaults: referer `https://github.com/kshehadeh/toby`, title `Toby`. Override with `TOBY_AI_GATEWAY_REFERER` and `TOBY_AI_GATEWAY_APP_TITLE` if needed.

Optional: developers linked to a Vercel project can use `vercel env pull` to provision `VERCEL_OIDC_TOKEN` for local runs without a static key.

## Default providers (optional)

In the same configure UI, open **Default Providers** to pick which connected integration Toby prefers for each category when you do not specify one:

| Category | Example integrations |
| -------- | -------------------- |
| Email | Gmail, Apple Mail |
| Calendar | Apple Calendar |
| Tasks | Todoist |
| Chat | Slack |
| Contacts | Azure AD |

These defaults help schedules and multi-integration chat pick the right tools.

## Personas and models

Each [persona](../personas) can use its own AI provider and model. The built-in **Toby** persona defaults to OpenAI (`openai` / `gpt-5-mini`). You can change provider and model per persona under **Personas** in configure.

Pretreatment, planning, and other auxiliary LLM calls follow the **active persona’s provider** (or your default persona when no session persona applies). Override the auxiliary model with `TOBY_PRETREAT_MODEL` (bare id for OpenAI, or a full gateway slug such as `openai/gpt-4.1-mini`).

## Back up your configuration

Before moving to a new machine, create an encrypted backup:

```bash
toby config backup
toby config backup ./backups
```

Restore with:

```bash
toby config restore ./backups/your-backup.tbybak
```

## Next steps

- [Configure and connect integrations](./configure-and-status)
- [Your first chat](./first-chat)
