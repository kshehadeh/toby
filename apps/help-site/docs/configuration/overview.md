---
sidebar_position: 1
title: Configuration overview
---

# Configuration overview

Toby’s preferences live in **Toby.app → Settings**. This section documents **settings that are not covered** in the feature guides for AI, integrations, personas, schedules, and so on.

## Settings map

| Settings area | What it controls | Documented here? |
| ------------- | ---------------- | ---------------- |
| **AI** | OpenAI, Vercel AI Gateway, Ollama keys and endpoints | [AI providers](../ai-providers/overview) · [Set up AI](../getting-started/setup-ai) |
| **Personas** | Instructions, default persona, model per persona | [Personas](../personas) |
| **Integrations** | Credentials and connect for Email, Slack, Calendar, … | [Integrations](../integrations/overview) · [Configure and connect](../getting-started/configure-and-status) |
| **Default Providers** | Preferred integration per category (email, tasks, …) | [Default providers](./default-providers) |
| **Chat** (inbound) | Listen for @mentions / external chat into Toby | [Inbound chat](./inbound-chat) · [Chat surfaces](../chat-surfaces/overview) |
| **Web Search** | Built-in `webSearch` tool (not an integration) | [Web Search](./web-search) |
| **Transcription** | Provider and key for Listen / recordings | [Transcription](./transcription) |
| **Listen / Recordings** | Capture and browse recordings | [Listen mode](../listen) · [Toby.app](../toby-app) |
| **Schedules** | Recurring prompts | [Schedules](../schedules) |
| **Projects** | Project folders, persona, pinned skills | [Projects](../projects) |
| **Skills** | Skill list and bodies | [Skills](../skills) |
| **Memories** | Durable memory browser | [Memories](../memories) |

## Open Settings

1. Open **Toby.app**.
2. Click **Settings** in the sidebar.
3. Use the left tree to open a section. Changes save as you edit.

![Toby.app Settings window](/img/toby-app-settings.png)

## Where data lives on disk

| Path | Contents |
| ---- | -------- |
| `~/.toby/config.json` | Non-secret preferences: connection flags, personas, defaults, web search, inbound chat, schedules metadata, and similar |
| `~/.toby/credentials.json` | Secrets (API keys, tokens). Never commit or share this file |
| `~/.toby/plugins/` | Installed integration plugins |
| `~/.toby/skills/` | User skills |
| `~/.toby/listen/recordings/` | Saved audio recordings and transcripts |
| `~/.toby/native-port` | Ephemeral port for Toby.app’s [Native API](../api/native-api) |
| Local service port | Daemon [Server API](../api/server-api) default `http://127.0.0.1:7847` (`web.port` in config when set) |

Most people only need the Settings UI. Paths above matter for backups, support, and advanced automation.

## What this section covers

- **[Web Search](./web-search)** — enable the global search tool (requires Vercel AI Gateway key)
- **[Default providers](./default-providers)** — prefer one integration when several share a category
- **[Inbound chat](./inbound-chat)** — let Slack (or another inbound-capable plugin) drive headless chat turns
- **[Transcription](./transcription)** — models used when Listen recordings are transcribed

For connecting Email, Todoist, Slack, and other services, use [Configure and connect](../getting-started/configure-and-status) and the [Integrations](../integrations/overview) guides.
