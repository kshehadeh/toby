---
sidebar_position: 2
title: Set up your AI
---

# Set up your AI

Toby uses an LLM for chat, summarization, and organization. You need an OpenAI API token before chatting.

## Open the configure UI

```bash
toby config
```

(`toby configure` is an alias for the same command.)

Navigate to **AI → OpenAI → API Token** and enter your key. Toby stores credentials in `~/.toby/credentials.json` (not in your shell history).

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

Each [persona](../personas) can use its own AI provider and model. The built-in **Toby** persona defaults to OpenAI. You can change provider and model per persona under **Personas** in configure.

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
