---
sidebar_position: 1
title: Settings overview
---

# Settings overview

Open **Settings** with the gear button in the toolbar or **⌘,**, then pick a
section on the left. Changes save as you make them.

![The Settings window, with sections listed on the left](/img/toby-app-settings.png)

| Section | What it's for | Guide |
| ------- | ------------- | ----- |
| **General** | Data folder, start at login, menu bar icon, global shortcuts, theme, accent color | [App tour](../toby-app#general) |
| **Home** | Which cards appear on Home and which persona writes their summaries | [App tour](../toby-app#customize-home) |
| **AI** | Connect AI providers and see your usage | [Set up your AI](../getting-started/setup-ai) · [AI providers](../ai-providers/overview) |
| **Library** | The model used to describe files you add to the Library | [Library](../library) |
| **Personas** | Create and edit personas, and pick each one's AI model | [Personas](../personas) |
| **Chat** | Let Slack @mentions start chats with Toby | [Inbound chat](./inbound-chat) |
| **Sync** | Keep settings in sync across your Macs | [Settings sync](./icloud-sync) |
| **Integrations** | Connect email, calendar, tasks, and other apps | [Connect your apps](../getting-started/configure-and-status) · [Integrations](../integrations/overview) |
| **Providers** | Which app Toby uses by default when you have more than one of a kind (for example two task apps) | [Default providers](./default-providers) |
| **Transcription** | How recordings are transcribed and summarized | [Transcription](./transcription) |
| **Web Search** | Let Toby search the web | [Web Search](./web-search) |
| **Weather** | Let Toby check the forecast | [Weather](./weather) |

Toby's location for "near me" questions is a macOS permission rather than a
setting. See [Location](./location).

## Where your data is stored

By default Toby’s data root is **`~/.toby`**. In **Settings → General → Home
directory** you can choose another folder; then every path below is under that
root instead. The CLI still uses `~/.toby` unless `TOBY_DIR` is set in the
environment.

| Path | Contents |
| ---- | -------- |
| `~/.toby/config.json` | Non-secret preferences: connection flags, personas, defaults, web search, inbound chat, schedules metadata, and similar |
| `~/.toby/credentials.json` | Secrets (API keys, tokens). On Mac this file is **encrypted**; Toby keeps the encryption key in your Keychain. Never commit or share this file |
| `~/.toby/chat.sqlite` | Chats, projects, schedules, flows, run history, and library catalog |
| `~/.toby/memory.sqlite` | Saved memories, sources, and memory audit data |
| `~/.toby/plugins/` | Installed integration plugins |
| `~/.toby/skills/` | User skills |
| `~/.toby/listen/recordings/` | Saved audio recordings and transcripts |
| `~/.toby/library/` | Indexed library files (copied documents, PDFs, and images) |
| `~/.toby/native-port` | Ephemeral port for Toby.app’s [Native API](../api/native-api) |
| Local service port | Daemon [Server API](../api/server-api) default `http://127.0.0.1:7847` (`web.port` in config when set) |

You don't need to touch these files. The paths matter for backups, support, and advanced automation.

For how credentials are encrypted on Mac, what a backup includes, and restore
safety, see **[Security](../security)**.
