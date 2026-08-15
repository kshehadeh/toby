# Toby documentation

Human- and flow-oriented docs for this repository.

| Doc | Description |
| --- | ----------- |
| [architecture.md](architecture.md) | Monorepo layout: `@toby/core` harness, `@toby/cli`, Toby.app, runtime flow, config paths. |
| [security.md](security.md) | Credentials at rest (Keychain-wrapped AES-GCM), backup/restore format and threat model. |
| [commands.md](commands.md) | Shared CLI commands, native app launch, `config backup` / `config restore`. |
| [projects.md](projects.md) | Projects: SQLite metadata, `AGENTS.md` guidance, skills, outputs. |
| [integrations.md](integrations.md) | `IntegrationModule` registry, first-party plugins, global tools. |
| [plugin-protocol.md](plugin-protocol.md) | Installable plugin CLI contract (v1): argv, stdin/stdout, discovery. |
| [create-integration.md](create-integration.md) | Checklist for adding a new bun-package plugin. |
| [apple-calendar.md](apple-calendar.md) | macOS Apple Calendar (EventKit via Toby.app). |
| [apple-contacts.md](apple-contacts.md) | macOS Apple Contacts plugin. |
| [apple-reminders.md](apple-reminders.md) | macOS Apple Reminders plugin. |
| [web-search.md](web-search.md) | Web Search via AI Gateway Perplexity: global `webSearch` tool. |
| [weather.md](weather.md) | Weather via Open-Meteo: global `getWeather` tool + Nominatim geocoding. |
| [location.md](location.md) | Current location via Toby.app: global `getMyLocation` tool + CoreLocation. |
| [macos-integration.md](macos-integration.md) | `toby-plugin-macos`: Wi‑Fi, Bluetooth, battery, audio, display, clipboard, shortcuts. |
| [news.md](news.md) | News plugin: Hacker News and The Guardian headlines and search. |
| [listen.md](listen.md) | Recording mode, native capture, transcription. |
| [native-helpers.md](native-helpers.md) | Toby.app native API pattern for platform bridges. |
| [chat-pipeline.md](chat-pipeline.md) | Chat turn nodes, events, pretreatment, tool-result cache. |
| [personas.md](personas.md) | Built-in personas (Toby, Mailman), locked fields, resolve/list hydration. |
| [flows.md](flows.md) | Named flow pipelines: SQLite definitions, built-in seed, Tool Executor, LLM Prompter, dashboard flows. |
| [daemon.md](daemon.md) | Background daemon: schedules, inbound, unified log (`logs/toby.log`). |
| [server-api.md](server-api.md) | Local daemon HTTP API: routes, SSE chat turns, configure. |
| [dashboard.md](dashboard.md) | Home dashboard cards: block shell, soft vs force refresh (`?fresh=1`), standard tools + flow AI blurbs, cache. |
| [dashboard-standard-tools-plan.md](dashboard-standard-tools-plan.md) | Dashboard standard-tool contract, merge rules, plugin checklist. |
| [chat-inbound.md](chat-inbound.md) | Inbound provider contract; external session keys; Slack thread/DM mapping. |
| [ai-caching.md](ai-caching.md) | Provider prompt caching adapters and token telemetry. |
| [memory.md](memory.md) | Durable user memory subsystem (`memory.sqlite`). |
| [build-executable.md](build-executable.md) | Bun `bun build --compile` standalone binary and releases. |
| [recent-changes-2026-06-12-to-18.md](recent-changes-2026-06-12-to-18.md) | Dated snapshot of major changes (June 12–18, 2026). |

Start from the repo root **[`AGENTS.md`](../AGENTS.md)** for a short contributor guide and links here.
