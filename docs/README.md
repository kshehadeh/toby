# Toby documentation

Human- and agent-oriented docs for this repository.

| Doc | Description |
| --- | ----------- |
| [architecture.md](architecture.md) | Monorepo layout: `@toby/core` harness vs `@toby/cli` app, runtime flow, config paths. |
| [recent-changes-2026-06-12-to-18.md](recent-changes-2026-06-12-to-18.md) | Dated summary of native app, recording, daemon, project, AI, plugin, and chat changes made June 12–18, 2026. |
| [commands.md](commands.md) | Shared CLI commands, native app launch behavior, and `config backup` / `config restore`. |
| [projects.md](projects.md) | Projects: scoped artifact collection with reference context, pinned skills, and recurring workflow support. |
| [integrations.md](integrations.md) | `IntegrationModule`, registry API, per-integration layout. |
| [plugin-protocol.md](plugin-protocol.md) | Installable plugin CLI contract (v1): argv subcommands, stdin/stdout, exit codes, JSON payloads, discovery. |
| [apple-calendar.md](apple-calendar.md) | macOS Apple Calendar integration (Calendar.app, EventKit via Toby.app native API). |
| [apple-reminders.md](apple-reminders.md) | macOS Apple Reminders integration (Reminders.app, EventKit via Toby.app native API). |
| [web-search.md](web-search.md) | Web Search via AI Gateway Perplexity: global `webSearch` tool, config. |
| [macos-integration.md](macos-integration.md) | Local macOS system tools via installable `toby-plugin-macos`: Wi‑Fi, Bluetooth, battery, audio, display brightness, clipboard, shortcuts. |
| [listen.md](listen.md) | Foreground audio recording mode, macOS helper protocol, and transcription notes. |
| [native-helpers.md](native-helpers.md) | Pattern for small native executables that bridge Toby to platform APIs. |
| [create-integration.md](create-integration.md) | Checklist for adding a new integration. |
| [chat-pipeline.md](chat-pipeline.md) | Chat turn node pipeline (`TurnInit` → `ExpandPrompt` → `AssembleMessages` → `RunModelTurn` → `PersistTurn`), events, and tool-result caching. |
| [daemon.md](daemon.md) | Background daemon: schedules, chat inbound (@mentions), `daemon.log`. |
| [server-api.md](server-api.md) | Local daemon HTTP API reference: routes, request/response shapes, SSE chat turns, configure actions. |
| [chat-inbound.md](chat-inbound.md) | Inbound provider contract, external sessions, extending to new chat platforms. |
| [ai-caching.md](ai-caching.md) | Provider prompt caching adapters, stable cache keys, and token telemetry. |
| [build-executable.md](build-executable.md) | Bun `bun build --compile` standalone binary, patches, and tag-triggered GitHub Releases. |

Start from the repo root **[`AGENTS.md`](../AGENTS.md)** for a short guide and links here.
