# Toby documentation

Human- and agent-oriented docs for this repository.

| Doc | Description |
| --- | ----------- |
| [architecture.md](architecture.md) | Monorepo layout: `@toby/core` harness vs `@toby/cli` app, runtime flow, config paths. |
| [recent-changes-2026-06-12-to-18.md](recent-changes-2026-06-12-to-18.md) | Dated summary of native app, recording, daemon, project, AI, plugin, and chat changes made June 12–18, 2026. |
| [commands.md](commands.md) | Shared CLI commands, default `chat` behavior, `-p` / `--prompt`, and `config backup` / `config restore`. |
| [projects.md](projects.md) | Projects: scoped artifact collection with reference context, pinned skills, and recurring workflow support. |
| [integrations.md](integrations.md) | `IntegrationModule`, registry API, per-integration layout. |
| [plugin-protocol.md](plugin-protocol.md) | Installable plugin CLI contract (v1): argv subcommands, stdin/stdout, exit codes, JSON payloads, discovery. |
| [apple-calendar.md](apple-calendar.md) | macOS Apple Calendar integration (Calendar.app, EventKit via Toby.app native API). |
| [web-search.md](web-search.md) | Web Search plugin (`toby-plugin-websearch`): Brave Search API, global `webSearch` tool. |
| [macos-integration.md](macos-integration.md) | Local macOS system tools via installable `toby-plugin-macos`: Wi‑Fi, Bluetooth, battery, audio, display brightness, clipboard, shortcuts. |
| [listen.md](listen.md) | Foreground audio recording mode, macOS helper protocol, and transcription notes. |
| [native-helpers.md](native-helpers.md) | Pattern for small native executables that bridge Toby to platform APIs. |
| [create-integration.md](create-integration.md) | Checklist for adding a new integration. |
| [chat-pipeline.md](chat-pipeline.md) | Chat turn node pipeline (`TurnInit` → `ExpandPrompt` → `AssembleMessages` → `RunModelTurn` → `PersistTurn`), events, and tool-result caching. |
| [daemon.md](daemon.md) | Background daemon: schedules, chat inbound (@mentions), `daemon.log`. |
| [web-ui.md](web-ui.md) | Localhost web UI (sessions, memories, configuration) served by the daemon. |
| [server-api.md](server-api.md) | Local daemon HTTP API reference: routes, request/response shapes, SSE chat turns, configure actions. |
| [chat-inbound.md](chat-inbound.md) | Inbound provider contract, external sessions, extending to new chat platforms. |
| [ai-caching.md](ai-caching.md) | Provider prompt caching adapters, stable cache keys, and token telemetry. |
| [slash-commands.md](slash-commands.md) | `toby chat` slash-command registry, current user-facing commands, and how to add new commands. |
| [ui.md](ui.md) | Shared Ink UI components, visual conventions, and shortcut conventions. |
| [terminal-input.md](terminal-input.md) | How terminal key events are parsed, encoded, and dispatched — guide for adding new shortcuts. |
| [build-executable.md](build-executable.md) | Bun `bun build --compile` standalone binary, patches, and tag-triggered GitHub Releases. |

Start from the repo root **[`AGENTS.md`](../AGENTS.md)** for a short guide and links here.
