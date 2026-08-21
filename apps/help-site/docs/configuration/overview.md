---
sidebar_position: 1
title: Configuration overview
---

# Configuration overview

Toby’s preferences live in **Toby.app → Settings**. This section documents **settings that are not covered** in the feature guides for AI, integrations, personas, schedules, and so on.

## Settings map

| Settings area | What it controls | Documented here? |
| ------------- | ---------------- | ---------------- |
| **General** | Home directory, start at login, menu bar icon, chat mode, theme, accent (app-local; not in `config.json`) | [Toby Mac App](../toby-app#settings) |
| **iCloud** | Encrypted settings/credentials snapshots via iCloud Drive | [iCloud sync](./icloud-sync) |
| **Dashboard** | Summary persona; hide onboarding checklist (hide is app-local) | [Toby Mac App](../toby-app#settings) |
| **AI** | OpenAI, Vercel AI Gateway, Ollama keys and endpoints | [AI providers](../ai-providers/overview) · [Set up AI](../getting-started/setup-ai) |
| **Personas** | Instructions, default persona, model per persona | [Personas](../personas) |
| **Integrations** | Credentials and connect for Email, Slack, Calendar, … | [Integrations](../integrations/overview) · [Configure and connect](../getting-started/configure-and-status) |
| **Default Providers** | Preferred integration per category (email, tasks, …) | [Default providers](./default-providers) |
| **Chat** (inbound) | Listen for @mentions / external chat into Toby | [Inbound chat](./inbound-chat) · [Chat surfaces](../chat-surfaces/overview) |
| **Web Search** | Built-in `webSearch` tool (not an integration) | [Web Search](./web-search) |
| **Weather** | Built-in `getWeather` tool (Open-Meteo; not an integration) | [Weather](./weather) |
| **Transcription** | Provider, key, and summary persona for Listen / recordings | [Transcription](./transcription) |
| **Schedules** | Recurring prompts | [Schedules](../schedules) |
| **Skills** | Skill list and bodies | [Skills](../skills) |
| **Memories** | Durable memory browser | [Memories](../memories) |

Projects and recordings are managed outside Settings (sidebar **Projects** and
**Recordings** windows). See [Projects](../projects) and [Listen mode](../listen).

## Open Settings

1. Open **Toby.app**.
2. Click the **gear** in the main toolbar (next to Search), or press **⌘,**.
3. Use the **top toolbar tabs** to open a section (**General**, Chat, AI, Dashboard, Transcription, and so on). Hierarchical areas such as **AI** show a list of providers on the left of the Settings window. Most changes save as you edit. **General** (home directory, start at login, menu bar icon, chat mode, theme, accent) and **Dashboard → Hide onboarding checklist** are stored only on this Mac in the app’s preferences, not in `~/.toby/config.json`.

![Toby.app Settings window](/img/toby-app-settings.png)

## Where data lives on disk

By default Toby’s data root is **`~/.toby`**. In **Settings → General → Home
directory** you can choose another folder; then every path below is under that
root instead. The CLI still uses `~/.toby` unless `TOBY_DIR` is set in the
environment.

| Path | Contents |
| ---- | -------- |
| `~/.toby/config.json` | Non-secret preferences: connection flags, personas, defaults, web search, inbound chat, schedules metadata, and similar |
| `~/.toby/credentials.json` | Secrets (API keys, tokens). On Mac this file is **encrypted**; Toby keeps the encryption key in your Keychain. Never commit or share this file |
| `~/.toby/plugins/` | Installed integration plugins |
| `~/.toby/skills/` | User skills |
| `~/.toby/listen/recordings/` | Saved audio recordings and transcripts |
| `~/.toby/native-port` | Ephemeral port for Toby.app’s [Native API](../api/native-api) |
| Local service port | Daemon [Server API](../api/server-api) default `http://127.0.0.1:7847` (`web.port` in config when set) |

Most people only need the Settings UI. Paths above matter for backups, support, and advanced automation.

For how credentials are encrypted on Mac, what a backup includes, and restore
safety, see **[Security](../security)**.

## What this section covers

- **[Web Search](./web-search)** — enable the global search tool (requires Vercel AI Gateway key)
- **[Weather](./weather)** — enable the global weather tool (Open-Meteo; optional paid API key)
- **[Default providers](./default-providers)** — prefer one integration when several share a category
- **[Inbound chat](./inbound-chat)** — let Slack (or another inbound-capable plugin) drive headless chat turns
- **[Transcription](./transcription)** — models used when Listen recordings are transcribed, plus the persona for recording summaries

For connecting Email, Todoist, Slack, and other services, use [Configure and connect](../getting-started/configure-and-status) and the [Integrations](../integrations/overview) guides.
