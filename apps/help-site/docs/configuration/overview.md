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
| **Transcription** | Provider, key, and summary persona for Listen / recordings | [Transcription](./transcription) |
| **Schedules** | Recurring prompts | [Schedules](../schedules) |
| **Skills** | Skill list and bodies | [Skills](../skills) |
| **Memories** | Durable memory browser | [Memories](../memories) |

Projects and recordings are managed outside Settings (sidebar **Projects** and
**Recordings** windows). See [Projects](../projects) and [Listen mode](../listen).

## Open Settings

1. Open **Toby.app**.
2. Click **Settings** in the sidebar.
3. Use the left tree to open a section. Changes save as you edit.

![Toby.app Settings window](/img/toby-app-settings.png)

## Where data lives on disk

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

### Credentials encryption (macOS)

Toby encrypts `credentials.json` on disk with AES-256-GCM and stores the data key in the macOS Keychain (service `dev.toby.credentials`). The first time Toby needs the key, macOS may prompt you to allow access for the Toby process.

- **Settings and plugins** keep working as before; encryption is transparent.
- **Backups** — use **File → Backup Settings…** in Toby.app (or `toby config backup` in Terminal) to export a password-protected archive of your config and secrets. Restore with **File → Restore Settings…** or `toby config restore`. Do not copy a raw `credentials.json` to another Mac.
- If the Keychain item is deleted while an encrypted credentials file remains, Toby cannot decrypt secrets until you restore a backup or re-enter keys in Settings.

## What this section covers

- **[Web Search](./web-search)** — enable the global search tool (requires Vercel AI Gateway key)
- **[Default providers](./default-providers)** — prefer one integration when several share a category
- **[Inbound chat](./inbound-chat)** — let Slack (or another inbound-capable plugin) drive headless chat turns
- **[Transcription](./transcription)** — models used when Listen recordings are transcribed, plus the persona for recording summaries

For connecting Email, Todoist, Slack, and other services, use [Configure and connect](../getting-started/configure-and-status) and the [Integrations](../integrations/overview) guides.
