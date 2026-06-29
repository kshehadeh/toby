---
sidebar_position: 3
title: Your first chat
---

# Your first chat

After you [set up AI](./setup-ai) and [connect at least one integration](./configure-and-status), start the assistant:

```bash
toby chat
```

Bare `toby` (no subcommand) also opens chat. On macOS, you can also start chatting from the native **Toby.app** once it is installed.

## Command-line syntax

| What you want | Command |
| ------------- | ------- |
| Open chat and type your first message in the TUI | `toby` or `toby chat` |
| Open chat with an initial message | `toby -p "summarize my unread email"` or `toby --prompt "…"` |
| Scope to one integration from the shell | `toby chat email "summarize unread from today"` |
| One-shot answer in the terminal | `toby chat --no-tui --prompt "quick question about my inbox"` |

**Mistyped commands** — Unknown root commands (for example `toby staatus` or `toby "summarize unread"`) are reported as errors. They do **not** launch chat with your text as a prompt. Use `toby -p "…"` or `toby chat …` when you mean to pass a prompt from the shell.

Root chat flags such as `--debug`, `--no-tui`, and `--persona` still work without the `chat` keyword (for example `toby --debug`). Inside `toby chat`, `-p` selects a **persona**; at the root, `-p` means **prompt**.

## How chat uses integrations

**All connected integrations (default)** — Type your message normally. Toby merges tools from every connected chat integration (Email, Todoist, Slack, Jira, and so on).

**One integration** — Start your message with the integration name in the TUI, or pass it on the command line:

```bash
toby chat email summarize my unread email from today
```

**Explicit set** — Use `--integration` one or more times; remaining words are only the prompt:

```bash
toby chat --integration email --integration todoist "What should I focus on today?"
```

Inside the chat UI, type **`/integration`** to open a multi-select picker (Space toggles, Enter applies).

Toby can also answer questions about its own setup. Try prompts like “Which integrations are connected?”, “What tools can you use?”, “How do I set up Jira?”, or “What skills are installed?”

## Web and URL reading

You can paste a URL and ask Toby to read it; the built-in `fetchWebContent` tool extracts the main readable page text without extra setup.

If you configure [Web Search](../integrations/web-search), Toby can also search the web from any chat session without selecting the integration explicitly.

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
| `/restart-server` | Restart the background server |
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
toby chat --no-tui --prompt "quick question about my inbox"
```

You can also combine a root prompt with `--no-tui`:

```bash
toby -p "quick question about my inbox" --no-tui
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
