---
sidebar_position: 2
title: Set up your AI
---

# Set up your AI

Toby uses an LLM for chat, summarization, and organization. You need at least one AI provider configured before chatting.

Toby supports two AI providers:

- **[OpenAI (direct)](../ai-providers/openai)** — a single OpenAI API key; models like `gpt-5-mini`
- **[Vercel AI Gateway](https://vercel.com/docs/ai-gateway)** — one Vercel key that routes to OpenAI, Anthropic, Google, and more via `provider/model` slugs like `openai/gpt-5-mini` or `anthropic/claude-sonnet-4.6`

You only need **one** provider to start. See the [AI providers overview](../ai-providers/overview) for help choosing.

## Step 1: Open Settings

Open **Toby.app** and click **Settings** in the sidebar. The Settings window shows a navigation tree on the left with sections for AI, providers, personas, and more.

![Toby.app Settings window with AI section](/img/toby-app-settings-ai.png)

Click **AI** in the tree to expand the provider list. You will see **OpenAI**, **Vercel AI Gateway**, and **Ollama** as sub-items.

## Step 2: Add your API key

### OpenAI (direct)

Click **OpenAI** under **AI** in the Settings tree. Paste your OpenAI API key into the **API Token** field.

![Toby.app OpenAI configuration](/img/toby-app-settings-openai.png)

Get an API key from [platform.openai.com](https://platform.openai.com/) — open **API keys** under your organization settings and create a new secret key. Toby stores it in `~/.toby/credentials.json`, never in your shell history.

For recommended models, see [OpenAI (direct)](../ai-providers/openai#recommended-models).

### Vercel AI Gateway

Click **Vercel AI Gateway** under **AI** in the Settings tree. Paste your Vercel AI Gateway API key into the **API Key** field.

![Toby.app Vercel AI Gateway configuration](/img/toby-app-settings-vercel.png)

Get an API key from the [Vercel dashboard](https://vercel.com/):

1. Sign in and open your team's **AI Gateway** settings.
2. Create an **API key** and copy it.

See Vercel's [AI Gateway authentication docs](https://vercel.com/docs/ai-gateway#authentication) for details, including how to use `VERCEL_OIDC_TOKEN` for local development on a linked Vercel project instead of a static key.

For recommended models, see [Vercel AI Gateway](../ai-providers/vercel-ai-gateway#recommended-models). You can also browse the full [list of models and providers](https://vercel.com/docs/ai-gateway/models-and-providers) in Vercel's docs.

## Step 3: Choose a persona and model

Each [persona](../personas) can use its own AI provider and model. The built-in **Toby** persona defaults to OpenAI (`openai` / `gpt-5-mini`).

To change the provider or model, click **Persona** in the Settings tree and pick **AI Provider** and **Model** from the dropdowns:

![Toby.app Persona settings with provider and model selection](/img/toby-app-settings-persona.png)

You can create additional personas with different providers or models — for example, a fast model for triage and a larger one for drafting. See [Personas](../personas) for details.

## Default providers (optional)

In the same Settings window, click **Default Providers** to pick which connected integration Toby prefers for each category when you do not specify one:

| Category | Example integrations |
| -------- | -------------------- |
| Email | Email |
| Calendar | Apple Calendar |
| Tasks | Todoist |
| Chat | Slack |
| Contacts | Azure AD |
| Documents | Notion |
| Work Tracker | Jira |

These defaults help schedules and multi-integration chat pick the right tools.

## Next steps

- [Configure and connect integrations](./configure-and-status)
- [Your first chat](./first-chat)
