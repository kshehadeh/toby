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

**All connected integrations (default)** — Type your message normally. Toby merges tools from every connected chat integration (Gmail, Todoist, Slack, Jira, and so on).

**One integration** — Start your message with the integration name:

```bash
toby gmail summarize my unread email from today
```

**Explicit set** — Use `--integration` one or more times; remaining words are only the prompt:

```bash
toby chat --integration gmail --integration todoist "What should I focus on today?"
```

Inside the chat UI, type **`/integration`** to open a multi-select picker (Space toggles, Enter applies).

Toby can also answer questions about its own setup. Try prompts like “Which integrations are connected?”, “What tools can you use?”, “How do I set up Jira?”, or “What skills are installed?”

## Web and URL reading

You can paste a URL and ask Toby to read it; the built-in `fetchWebContent` tool extracts the main readable page text without extra setup.

If you configure [Brave Search](../integrations/brave-search), Toby can also search the web from any chat session without selecting the Brave Search integration explicitly.

## Useful slash commands

| Command | What it does |
| ------- | -------------- |
| `/help` | List slash commands and shortcuts |
| `/config` | Open the configure UI |
| `/connect` | Connect an integration |
| `/disconnect` | Disconnect an integration |
| `/integration` | Choose which integrations are active in this session |
| `/listen` | Start recording microphone and system audio in this chat |
| `/stop-listening` | Stop, save, transcribe, and add the recording transcript as context |
| `/persona` | Switch persona |
| `/skills` | Open the skills manager |
| `/schedules` | Open the schedules manager |
| `/start-daemon` | Start the background daemon |
| `/stop-daemon` | Stop the background daemon |
| `/web` | Open the local web UI in your browser |
| `/upgrade` | Stage the latest release |
| `/restart` | Restart Toby, applying a staged upgrade when available |
| `/new` | Start a new chat session |
| `/sessions` | Browse saved sessions |
| `/exit` | Leave chat |

Press **Shift+Tab** to cycle personas without leaving chat.

## Record audio into chat

On macOS, `/listen` starts a recording inside the active chat session. `/stop-listening` saves the recording, transcribes it, and adds the transcript as context for the assistant so you can ask for a summary or action items. It uses the same helper and permissions as `toby listen`.

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

The chat status line can show context-window usage as `ctx N%` when Toby knows the selected model’s context size. Pretreatment can also select the most relevant tools for the prompt and assign a short session name automatically.

## Next steps

- [Integrations overview](../integrations/overview) — per-service setup
- [Personas](../personas) · [Skills](../skills) · [Memories](../memories) · [Schedules](../schedules)
- [Examples](../examples)
