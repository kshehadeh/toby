---
sidebar_position: 2
title: Set up your AI
---

# Set up your AI

Toby uses an LLM for chat, summarization, and organization. You need at least one AI provider configured before chatting.

**Recommended for new installs: [Vercel AI Gateway](../ai-providers/vercel-ai-gateway).** One free Vercel account and one API key unlock multi-model chat plus Toby web search and transcription catalogs.

Toby also supports:

- **[OpenAI (direct)](../ai-providers/openai)** — a single OpenAI API key; models like `gpt-5-mini`
- **[Chutes](../ai-providers/chutes)** — open-source TEE-backed models (DeepSeek, Qwen, GLM, Kimi) via Chutes' OpenAI-compatible endpoint
- **[OpenRouter](../ai-providers/openrouter)** — hundreds of models from many vendors through a single OpenRouter API key
- **Ollama** — run open-source models locally on your machine (no API key needed)

You only need **one** provider to start. See the [AI providers overview](../ai-providers/overview) for help choosing.

## Recommended: guided Vercel setup

1. On the **Dashboard**, open the onboarding checklist and click **Connect** on **Configure AI provider** (or open **Settings → AI → Vercel AI Gateway → Guided setup**).
2. Follow the in-app wizard:
   - Create or sign in to a free [Vercel](https://vercel.com/signup) account
   - Open **AI Gateway → API Keys**, create a key named **Toby**, and copy it
   - Paste the key into Toby and click **Validate & connect**
3. Toby checks the key with Vercel, saves it securely, and sets the built-in **Toby** persona to **Vercel AI Gateway** with model `openai/gpt-5-mini`.

New Vercel teams receive free AI Gateway credits (a subset of models). See [Vercel AI Gateway pricing](https://vercel.com/docs/ai-gateway/pricing).

## Other providers: Settings

Open **Toby.app → Settings**. The Settings window has sections for AI, personas, integrations, and more.

![Toby.app Settings window with AI section](/img/toby-app-settings-ai.png)

Click **AI** to expand the provider list: **OpenAI**, **Vercel AI Gateway**, **Ollama**, **Chutes**, and **OpenRouter**.

### OpenAI (direct)

Click **OpenAI** under **AI**. Paste your OpenAI API key into the **API Token** field.

![Toby.app OpenAI configuration](/img/toby-app-settings-openai.png)

Get an API key from [platform.openai.com](https://platform.openai.com/) — open **API keys** under your organization settings and create a new secret key. Toby stores it in `~/.toby/credentials.json` on your Mac.

For recommended models, see [OpenAI (direct)](../ai-providers/openai#recommended-models).

### Vercel AI Gateway (manual)

If you prefer not to use the wizard, click **Vercel AI Gateway** under **AI** and paste your key into **API Key**, or use **Guided setup** on that page.

![Toby.app Vercel AI Gateway configuration](/img/toby-app-settings-vercel.png)

See [Vercel AI Gateway](../ai-providers/vercel-ai-gateway) for deep links, OIDC, and recommended models.

### Chutes

Click **Chutes** under **AI** in the Settings tree. Paste your Chutes API key into the **API Key** field.

Get an API key from [chutes.ai](https://chutes.ai/) — open **Auth → Start** to create a key (starts with `cpk_`).

For recommended models, see [Chutes](../ai-providers/chutes#recommended-models). The model list is fetched live from Chutes' public catalog, so you can browse models even before adding an API key.

### OpenRouter

Click **OpenRouter** under **AI** in the Settings tree. Paste your OpenRouter API key into the **API Key** field.

Get an API key from [openrouter.ai/keys](https://openrouter.ai/keys).

For recommended models, see [OpenRouter](../ai-providers/openrouter#recommended-models). The model list is fetched live from OpenRouter's public catalog, so you can browse models even before adding an API key.

## Choose a persona and model

Each [persona](../personas) can use its own AI provider and model. Guided Vercel setup points the built-in **Toby** persona at `vercel` / `openai/gpt-5-mini`. Without that wizard, the built-in default is OpenAI (`openai` / `gpt-5-mini`) until you change it.

To change the provider or model, open **Settings → Personas** and pick **AI Provider** and **Model** from the dropdowns:

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
| Contacts | Apple Contacts |
| Documents | Notion |
| Work Tracker | Jira |

These defaults help schedules and multi-integration chat pick the right tools. Full detail: [Default providers](../configuration/default-providers).

## Next steps

- [Configure and connect integrations](./configure-and-status)
- [Configuration](../configuration/overview) — web search, inbound chat, transcription, and more
- [Your first chat](./first-chat)
