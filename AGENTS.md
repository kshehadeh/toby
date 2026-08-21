# Agent and contributor guide

This repository is **Toby**, a personal productivity product: a **native macOS
app (Toby.app)**, a **maintenance CLI**, installable **integration plugins**,
and a shared harness package. The repo is a **Bun monorepo**: harness code lives
in **`@toby/core`**, the Commander CLI in **`@toby/cli`**, and SwiftUI UI in
**`apps/toby-app/`**. Use **Bun** for installs and scripts (`bun install`,
`bun run …`).

Use this file as the **entry point** for orientation. Detailed design lives under
[`docs/`](docs/), especially [`docs/architecture.md`](docs/architecture.md).

## Documentation index

| Document | Purpose |
| -------- | ------- |
| [`docs/architecture.md`](docs/architecture.md) | Monorepo layout, runtime entrypoints, config paths, native bridge. |
| [`docs/security.md`](docs/security.md) | Credentials encryption (Keychain), backup/restore, iCloud sync threat model. |
| [`docs/icloud-sync.md`](docs/icloud-sync.md) | Encrypted settings snapshots across Macs (iCloud Drive or a shared folder). |
| [`docs/commands.md`](docs/commands.md) | CLI commands, app launch, config backup/restore/sync. |
| [`docs/integrations.md`](docs/integrations.md) | `IntegrationModule` registry, first-party plugins, global tools. |
| [`docs/plugin-protocol.md`](docs/plugin-protocol.md) | Installable plugin contract (v1): subcommands, JSON, discovery. |
| [`docs/create-integration.md`](docs/create-integration.md) | Checklist for adding a new plugin integration. |
| [`docs/chat-pipeline.md`](docs/chat-pipeline.md) | Chat turn node pipeline, events, pretreatment, tool-result cache. |
| [`docs/personas.md`](docs/personas.md) | Built-in personas (Toby, Mailman), locked fields, resolve/list hydration. |
| [`docs/flows.md`](docs/flows.md) | Named flow pipelines: SQLite definitions, seed-on-miss built-ins, nodes, runtime API, dashboard flows. |
| [`docs/projects.md`](docs/projects.md) | Projects: SQLite metadata, `AGENTS.md`, skills, outputs. |
| [`docs/daemon.md`](docs/daemon.md) | Background daemon: schedules, inbound, unified log. |
| [`docs/server-api.md`](docs/server-api.md) | Local daemon HTTP API: routes, SSE chat, configure. |
| [`docs/dashboard.md`](docs/dashboard.md) | Home dashboard cards: block shell, soft vs force refresh, standard tools + flow AI blurbs, cache. |
| [`docs/chat-inbound.md`](docs/chat-inbound.md) | Inbound provider contract; external session keys; Slack thread/DM mapping. |
| [`docs/ai-caching.md`](docs/ai-caching.md) | Provider prompt caching and token telemetry. |
| [`docs/memory.md`](docs/memory.md) | Durable user memory (`memory.sqlite`). |
| [`docs/macos-integration.md`](docs/macos-integration.md) | `toby-plugin-macos` system control via Toby.app native API. |
| [`docs/news.md`](docs/news.md) | News plugin via Hacker News and The Guardian. |
| [`docs/apple-calendar.md`](docs/apple-calendar.md) | Apple Calendar plugin + EventKit native API. |
| [`docs/apple-contacts.md`](docs/apple-contacts.md) | Apple Contacts plugin. |
| [`docs/apple-reminders.md`](docs/apple-reminders.md) | Apple Reminders plugin. |
| [`docs/web-search.md`](docs/web-search.md) | Global `webSearch` via AI Gateway Perplexity. |
| [`docs/weather.md`](docs/weather.md) | Global `getWeather` via Open-Meteo + Nominatim. |
| [`docs/location.md`](docs/location.md) | Global `getMyLocation` via Toby.app CoreLocation. |
| [`docs/listen.md`](docs/listen.md) | Recording / transcription lifecycle. |
| [`docs/native-helpers.md`](docs/native-helpers.md) | Toby.app native API pattern for platform bridges. |
| [`docs/build-executable.md`](docs/build-executable.md) | Bun compile binary and release packaging. |
| [`docs/README.md`](docs/README.md) | Full docs index. |

## Core vs CLI vs Toby.app

| Belongs in `@toby/core` | Belongs in `apps/cli` | Belongs in `apps/toby-app` |
| ----------------------- | --------------------- | -------------------------- |
| Chat pipeline, AI, tools, pretreatment | Commander entry (`cli.ts`, `commands/`) | SwiftUI product UI |
| Integrations registry + plugin adapter | Daemon start/stop, schedules CLI, upgrade | Daemon client + native API server |
| Config, personas, skills, memory, projects | Listen CLI glue, plugins install CLI | TCC-gated native handlers (EventKit, audio, …) |
| Session store, inbound router, HTTP routes | Release handoff helpers | Windowing, recordings browser, settings UI |

**Dependency rule:** `apps/cli` imports `@toby/core`; core must **not** import
from `apps/cli`. Toby.app does **not** import core; it talks to the daemon over
HTTP/SSE and exposes a separate native localhost API for plugins.

**Imports:** In the CLI app, use `@toby/core/...`. Core uses relative imports
internally.

**Tests:** CLI/plugin tests under `apps/cli/tests/` and plugin packages; import
harness from `@toby/core`. Swift tests under `apps/toby-app/Tests/`.

When unsure: if the daemon or a headless script can call it without a UI, it
belongs in core.

## Conventions for agents

- **All new plugins must be TypeScript bun-package plugins** (`manifest.json` +
  TypeScript entry, run via bundled Bun). Do not create compiled binary or Swift
  plugins. The only native macOS product code in-repo is Toby.app
  (`apps/toby-app/`). For EventKit / Shortcuts / TCC, delegate to Toby.app’s
  native API from the TypeScript plugin. See
  [`apps/plugin-macos/`](apps/plugin-macos/) and
  [`apps/plugin-applecalendar/`](apps/plugin-applecalendar/).
- Prefer **plugin-local** code under `apps/plugin-<name>/` for integration
  behavior. Do not reintroduce first-party modules under
  `packages/core/src/integrations/<name>/` unless there is a deliberate
  built-in exception (`BUILTIN_MODULES` is empty).
- **Discovery** registers plugins automatically; no `MODULES` array edit is
  required for new plugins. See [`docs/create-integration.md`](docs/create-integration.md).
- **Shared CLI commands** (`connect`, `disconnect`, `status`, `config`,
  `daemon`, `plugins`, …) live in [`apps/cli/src/commands/`](apps/cli/src/commands/)
  and stay generic; they resolve behavior through the core registry.
- After substantive changes, run `bun run lint`, `bun run typecheck`, and
  `bun run test` (and Swift tests when touching Toby.app).
- **Documentation:** when changing or adding functionality (new features,
  enhancements, or fixes that change documented behavior), update both
  [`docs/`](docs/) (contributor/technical) and
  [`apps/help-site/docs/`](apps/help-site/docs/) (user-facing) when those areas
  already cover the topic—or create coverage for new user/developer-facing work.
  If it is unclear whether docs need updating, ask. Use the `toby-docs` skill
  (`.agents/skills/toby-docs/`).
- When committing, use the `atomic-conventional-commit` skill for cohesive
  Conventional Commit messages.
- **Swift / macOS reviews:** use the multi-skill pipeline under
  [`.agents/skills/`](.agents/skills/) (see
  [Swift review skills](#swift-review-skills) below). Do not re-discover app
  architecture on every review — load
  [`.agents/context/swift-project-assessment.yaml`](.agents/context/swift-project-assessment.yaml).
- **Dev loops:** `bun run dev` for CLI watch; `bun run app` to build/open the
  native app. Do not expect an Ink chat TUI — interactive UI is Toby.app only.

## Swift review skills

Toby.app reviews are intentionally split so each skill stays focused and
produces fewer false positives:

```
swift-project-assessment          # context only — never nitpicks code
        │
        ▼
swiftui-architecture-review     # architecture + SwiftUI quality
        │
        ▼
toby-engineering-standards      # org/repo culture (ownership, tests, DS)
        │
        ▼
toby-swift-review               # orchestrator + findings aggregator
```

| Skill | Role |
| ----- | ---- |
| [`swift-project-assessment`](.agents/skills/swift-project-assessment/) | What kind of app this is, conventions, feature boundaries; writes `.agents/context/swift-project-assessment.yaml` |
| [`swiftui-architecture-review`](.agents/skills/swiftui-architecture-review/) | Assumes assessment exists; state, performance, concurrency, navigation, a11y, maintainability |
| [`toby-engineering-standards`](.agents/skills/toby-engineering-standards/) | Toby-specific: ownership, design system, file size, DI, tests, logging, plugins policy |
| [`toby-swift-review`](.agents/skills/toby-swift-review/) | Runs the pipeline and aggregates findings |

**Reference libraries (not project context):**
[`swiftui-pro`](.agents/skills/swiftui-pro/),
[`swiftui-expert-skill`](.agents/skills/swiftui-expert-skill/) (deep topic
refs + Instruments). **Windows:**
[`toby-native-window`](.agents/skills/toby-native-window/).

Slash commands: `/toby-swift-review`, `/swift-project-assessment`,
`/swiftui-architecture-review`, `/toby-engineering-standards`.

## Quick paths

- CLI entry: [`apps/cli/src/cli.ts`](apps/cli/src/cli.ts)
- Harness (`@toby/core`): [`packages/core/src/`](packages/core/src/)
- Integration types: [`packages/core/src/integrations/types.ts`](packages/core/src/integrations/types.ts)
- Integration registry: [`packages/core/src/integrations/index.ts`](packages/core/src/integrations/index.ts)
- Plugin runtime: [`packages/core/src/integrations/plugins/`](packages/core/src/integrations/plugins/)
- User config: [`packages/core/src/config/index.ts`](packages/core/src/config/index.ts)
  (paths under `~/.toby/`, including `~/.toby/skills/` and `~/.toby/plugins/`)
- Native app: [`apps/toby-app/`](apps/toby-app/)
