---
sidebar_position: 2
title: Set up your AI
---

# Set up your AI

Toby uses an LLM for chat, summarization, and organization. You need at least one AI provider configured before chatting.

Supported providers:

- **[OpenAI (direct)](../ai-providers/openai)** — API key from platform.openai.com; models like `gpt-5-mini`
- **[Vercel AI Gateway](../ai-providers/vercel-ai-gateway)** — one Vercel key; models like `openai/gpt-5-mini` or `anthropic/claude-sonnet-4.6`

See the [AI providers overview](../ai-providers/overview) for how to choose between them and which models Toby recommends.

## Open the configure UI

```bash
toby config
```

(`toby configure` is an alias for the same command.)

Under **AI**, add credentials for at least one provider (steps in the provider pages above). Toby stores keys in `~/.toby/credentials.json`, not in your shell history.

## Default providers (optional)

In the same configure UI, open **Default Providers** to pick which connected integration Toby prefers for each category when you do not specify one:

| Category | Example integrations |
| -------- | -------------------- |
| Email | Email |
| Calendar | Apple Calendar |
| Tasks | Todoist |
| Chat | Slack |
| Contacts | Azure AD |
| Search | Web Search |
| Work Tracker | Jira |

These defaults help schedules and multi-integration chat pick the right tools.

## Personas and models

Each [persona](../personas) can use its own AI provider and model. The built-in **Toby** persona defaults to OpenAI (`openai` / `gpt-5-mini`). You can change provider and model per persona under **Personas** in configure.

For recommended models per provider, see [OpenAI (direct)](../ai-providers/openai#recommended-models) and [Vercel AI Gateway](../ai-providers/vercel-ai-gateway#recommended-models).

Pretreatment follows the **active persona’s provider** (or your default persona when no session persona applies). Default pretreatment models are `gpt-4.1-nano` (OpenAI) or `openai/gpt-4.1-nano` (gateway). Override with `TOBY_PRETREAT_MODEL`. Planning uses its own model (`gpt-4.1-mini`). Set `TOBY_PRETREAT_DELTA=0` to disable follow-up delta pretreatment.

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
