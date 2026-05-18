---
sidebar_position: 3
title: Your first chat
---

# Your first chat

After you [set up AI](./setup-ai) and [connect at least one integration](./configure-and-status), start the assistant:

```bash
toby chat
```

`toby` with no subcommand also opens chat.

## How chat uses integrations

**All connected integrations (default)** — Type your message normally. Toby merges tools from every connected chat integration (Gmail, Todoist, Slack, and so on).

**One integration** — Start your message with the integration name:

```bash
toby gmail summarize my unread email from today
```

**Explicit set** — Use `--integration` one or more times; remaining words are only the prompt:

```bash
toby chat --integration gmail --integration todoist "What should I focus on today?"
```

Inside the chat UI, type **`/integration`** to open a multi-select picker (Space toggles, Enter applies).

## Useful slash commands

| Command | What it does |
| ------- | -------------- |
| `/help` | List slash commands and shortcuts |
| `/config` | Open the configure UI |
| `/integration` | Choose which integrations are active in this session |
| `/persona` | Switch persona |
| `/skills` | Open the skills manager |
| `/schedules` | Open the schedules manager |
| `/new` | Start a new chat session |
| `/sessions` | Browse saved sessions |
| `/exit` | Leave chat |

Press **Shift+Tab** to cycle personas without leaving chat.

## Single-turn mode (no TUI)

For a one-shot answer in the terminal:

```bash
toby --no-tui "quick question about my inbox"
```

## Debug pretreatment (optional)

To see which skills were selected and other pipeline details:

```bash
toby chat --debug
```

## Next steps

- [Integrations overview](../integrations/overview) — per-service setup
- [Personas](../personas) · [Skills](../skills) · [Memories](../memories) · [Schedules](../schedules)
- [Examples](../examples)
