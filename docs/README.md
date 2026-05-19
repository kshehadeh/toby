# Toby documentation

Human- and agent-oriented docs for this repository.

| Doc | Description |
| --- | ----------- |
| [architecture.md](architecture.md) | Repo layout, CLI entry, config paths, AI/UI boundaries. |
| [commands.md](commands.md) | Shared CLI commands, including `config backup` and `config restore`. |
| [integrations.md](integrations.md) | `IntegrationModule`, registry API, per-integration layout. |
| [apple-mail.md](apple-mail.md) | macOS Apple Mail integration (local Mail.app, AppleScript tools). |
| [apple-calendar.md](apple-calendar.md) | macOS Apple Calendar integration (Calendar.app, EventKit search, AppleScript CRUD). |
| [create-integration.md](create-integration.md) | Checklist for adding a new integration. |
| [chat-pipeline.md](chat-pipeline.md) | `toby chat` turn flow plus tool-result caching behavior. |
| [daemon.md](daemon.md) | Background daemon: schedules, chat inbound (@mentions), `daemon.log`. |
| [chat-inbound.md](chat-inbound.md) | Inbound provider contract, external sessions, extending to new chat platforms. |
| [ai-caching.md](ai-caching.md) | Provider prompt caching adapters, stable cache keys, and token telemetry. |
| [slash-commands.md](slash-commands.md) | `toby chat` slash-command registry and how to add new commands. |
| [ui.md](ui.md) | Shared Ink UI components, visual conventions, and shortcut conventions. |
| [terminal-input.md](terminal-input.md) | How terminal key events are parsed, encoded, and dispatched — guide for adding new shortcuts. |
| [build-executable.md](build-executable.md) | Bun `bun build --compile` standalone binary, patches, and tag-triggered GitHub Releases. |

Start from the repo root **[`AGENTS.md`](../AGENTS.md)** for a short guide and links here.
