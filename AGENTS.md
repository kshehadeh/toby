# Agent and contributor guide

This repository is **Toby**, a personal productivity product: a **native macOS
app (Toby.app)**, a **maintenance CLI**, installable **integration plugins**,
and a shared harness package. The repo is a **Bun monorepo** (Bun 1.3.10,
Turbo 2.10, Biome 1.9, TypeScript 5.9): harness code lives in **`@toby/core`**,
the Commander CLI in **`@toby/cli`**, and SwiftUI UI in **`apps/toby-app/`**.
Use **Bun** for installs and scripts (`bun install`, `bun run …`) — do not use
`npm`/`yarn`/`pnpm`.

Use this file as the **entry point** for orientation. Detailed design lives under
[`docs/`](docs/), especially [`docs/architecture.md`](docs/architecture.md).
`CLAUDE.md` is a shorter dev quick-start; this file is the canonical agent
guide.

## Workspaces and tooling

| Concern | Detail |
| ------- | ------ |
| Workspaces | `apps/*` + `packages/*` declared in root `package.json` |
| Packages | `@toby/core` (`packages/core`), `@toby/cli` (`apps/cli`), `@toby/helper-scripts` (`packages/helper-scripts`), `@toby/help-site` (`apps/help-site`), plus `apps/plugin-*` |
| Package manager | `bun@1.3.10` (`packageManager` field); `bun.lock` is the lockfile — never run `npm install` (it rewrites `yarn.lock`-style artifacts) |
| Task runner | Turbo (`turbo.json`): `build` (`dependsOn: ^build`), `typecheck`, `lint`, `test` (`dependsOn: ^build`), `dev`/`start` (persistent) |
| Lint/format | Biome (`biome.json`, ignores `.build/**`, `dist/**`, `apps/toby-app/**`, `.agents/**`); `bun run lint` / `bun run lint:fix` / `bun run format` |
| Tests (TS) | Bun native runner `bun:test` (see `.agents/skills/bun-test-runner/`); executed via `turbo run test` / `bun run test` and `bun run --cwd apps/cli test:watch` |
| Tests (Swift) | `bun run test:swift` (`swift test --package-path apps/toby-app`, ViewInspector + Swift Testing, requires `xcode-select -s /Applications/Xcode.app/Contents/Developer`) |
| Dead-code | `knip.json` (workspaces `apps/cli`, `packages/core`, `packages/helper-scripts`, `apps/help-site`) |
| Git hooks | Installed by `postinstall` via `scripts/install-git-hooks.mjs` + `lint-staged` (Biome on `*.{js,jsx,ts,tsx,json,jsonc}`) |

Root scripts of interest: `build`, `build:plugins` / `build:plugin:*`, `build:executable` (`bun build --compile` from `apps/cli/src/cli.ts` → `dist/toby`), `build:app` / `app` / `dev`, `dev:turbo`, `typecheck`, `lint`, `test`, `test:swift`, `release`/`release:dry`/`release:ci` (release-it).

## Monorepo layout

```
apps/
  cli/                    @toby/cli — Commander CLI (apps/cli/src/cli.ts, commands/)
  toby-app/               Toby.app — Swift 6 / SwiftUI, macOS 26+ (Sources/TobyApp/, Tests/)
  help-site/              Docusaurus user docs (apps/help-site/docs/)
  plugin-email/           toby-plugin-email  (bun-package plugin)
  plugin-slack/           toby-plugin-slack  (chat + inbound)
  plugin-jira/            toby-plugin-jira
  plugin-notion/          toby-plugin-notion
  plugin-todoist/         toby-plugin-todoist
  plugin-macos/           toby-plugin-macos  (delegates to Toby.app native API)
  plugin-applecalendar/   toby-plugin-applecalendar (EventKit via native API)
  plugin-applecontacts/   toby-plugin-applecontacts (Contacts via native API)
  plugin-applereminders/  toby-plugin-applereminders (EventKit via native API)
  plugin-news/            toby-plugin-news (Hacker News + Guardian)
  plugin-sample-ts/       toby-plugin-sample-ts (minimal reference)
packages/
  core/src/               @toby/core — harness (chat-pipeline, ai, integrations/plugins, config, personas, skills, memory, projects, flows, daemon, schedules, session-store, logging)
  helper-scripts/         @toby/helper-scripts
docs/                     Contributor/technical docs (see index below)
scripts/                  build-app.sh, build-release-artifacts.sh, build-dmg.sh, release-ci.mjs, verify-release-artifacts.mjs, …
.agents/skills/           Agent skills (see Skills section)
.agents/context/          Durable assessment artifact (swift-project-assessment.yaml)
```

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

**Tests:** CLI/plugin tests under `apps/cli/tests/` (and per-plugin packages);
import harness from `@toby/core`. Swift tests under `apps/toby-app/Tests/`.
Write TS tests with `bun:test` (`describe`/`it`/`expect`/`mock`), not Jest/Vitest
imports — see `.agents/skills/bun-test-runner/SKILL.md`.

When unsure: if the daemon or a headless script can call it without a UI, it
belongs in core.

## Runtime and data paths

All user data lives under `~/.toby/` (overridable via `TOBY_DIR` env var —
`resolveTobyDir()` in `packages/core/src/config/index.ts` implements
`TOBY_DIR` → `~/.toby` precedence). Never hardcode `~/.toby`; use the helpers
in `packages/core/src/config/index.ts`.

| Path | Role |
| ---- | ---- |
| `~/.toby/config.json` | Non-secret prefs: personas, connection flags (`connectedAt`), defaults (`config.json`, mode `0o600`) |
| `~/.toby/credentials.json` | Secrets (AI keys, `integrations.<plugin>` tokens); **AES-256-GCM encrypted at rest on macOS**, data key in Keychain `dev.toby.credentials` (`credentials-crypto.ts`, `credentials-keychain.ts`). Always use `readCredentials`/`writeCredentials` — never read the file directly |
| `~/.toby/chat.sqlite` | Chats, projects, schedules, flows, run history, tool cache |
| `~/.toby/memory.sqlite` | Memories, sources, proposals, embeddings, audit |
| `~/.toby/logs/toby.log` | Unified JSON-lines log (`source` discriminator, `TOBY_LOG_LEVEL=debug` for verbose) |
| `~/.toby/listen/recordings/<id>/` | Audio, metadata, transcripts |
| `~/.toby/native-port` | Ephemeral port file for Toby.app native API server |
| `~/.toby/sync-state.json` | Sync bookkeeping (device id, hash, backend, folder) |
| `~/.toby/plugins/` | Installed plugins (`toby-plugin-*` dirs) |
| `~/.toby/skills/` | User skills |
| `~/.toby/projects/<slug>/` | Project metadata, skills, outputs |
| `~/.toby/persona/images/` | Persona images |
| `~/.toby/helpers/` | Helper binaries (installed) |

Additional env: `TOBY_PLUGINS_DIR` (overrides plugin discovery in dev, e.g. `TOBY_PLUGINS_DIR=$PWD/dist`), `TOBY_LOG_LEVEL`.

See [`docs/architecture.md`](docs/architecture.md), [`docs/security.md`](docs/security.md), [`docs/commands.md`](docs/commands.md).

## Integration plugin system

- **All new plugins must be TypeScript bun-package plugins** (`manifest.json` +
  TypeScript entry, run via bundled Bun). Do not create compiled binary or Swift
  plugins. The only native macOS product code in-repo is Toby.app
  (`apps/toby-app/`). For EventKit / Shortcuts / TCC, delegate to Toby.app's
  native API from the TypeScript plugin. See
  [`apps/plugin-macos/`](apps/plugin-macos/) and
  [`apps/plugin-applecalendar/`](apps/plugin-applecalendar/).
- **Manifest:** `manifest.json` with `name`, `displayName`, `description`, `version`, `protocolVersion: "1"`, `runtime: { type: "bun", entry: "src/index.ts" }`, optional `capabilities` (`"chat"`/`"inbound"`), `providerCategories`, `icon`/`iconAsset`.
- **Discovery precedence:** (1) dir of running `toby` binary, (2) repo `dist/` if it contains plugins, (3) `~/.toby/plugins/` (`$TOBY_DIR/plugins/`). First match wins per name.
- **Protocol (v1):** subcommands `status`, `connect`/`disconnect`, `config shape`/`get`/`set`, `tools list`/`tools execute`, `setup`/`setup guide`, `inbound run` (NDJSON). One JSON object on stdout, config envelope on stdin, exit `0`/`1`/`2`, honor `dryRun`, return `appliedActions`. Never read/write `~/.toby/` from the plugin.
- Prefer **plugin-local** code under `apps/plugin-<name>/` for integration
  behavior. Do not reintroduce first-party modules under
  `packages/core/src/integrations/<name>/` unless there is a deliberate
  built-in exception (`BUILTIN_MODULES` is currently **empty**).
- **Discovery** registers plugins automatically; no `MODULES` array edit is
  required for new plugins. See [`docs/create-integration.md`](docs/create-integration.md) and [`docs/plugin-protocol.md`](docs/plugin-protocol.md).

## CLI and daemon

- Entry: [`apps/cli/src/cli.ts`](apps/cli/src/cli.ts) — registers built-in commands then `registerCommands` on each `IntegrationModule`.
- Generic commands in [`apps/cli/src/commands/`](apps/cli/src/commands/): `connect`, `disconnect`, `status`, `config` (`backup`/`restore`/`sync`), `daemon`, `plugins` (`list`/`install`/`uninstall`/`inspect`/`doctor`/`setup`), `schedules`, `listen`, `skills`, `sessions`, `app`, `upgrade`, `internal-handoff`. They resolve behavior through the core registry — no `if (name === "…")` branches.
- Bare `toby` (no subcommand) opens Toby.app (`toby app` is explicit).
- Chat/sessions/configure are **Toby.app + daemon HTTP API** surfaces (`127.0.0.1` SSE `POST /api/sessions/:id/turn`, `ChatEvent` stream). See [`docs/server-api.md`](docs/server-api.md), [`docs/daemon.md`](docs/daemon.md), [`docs/chat-pipeline.md`](docs/chat-pipeline.md).
- Native bridge: Toby.app publishes a random port to `~/.toby/native-port` (`GET /api/native/health`); plugins `toby-plugin-macos`/`applecalendar`/`applecontacts`/`applereminders` delegate there and auto-launch the app. See [`docs/native-helpers.md`](docs/native-helpers.md).

## Chat pipeline, flows, and native helpers (pointers)

- Chat turn pipeline: six nodes `TurnInit → ExpandPrompt → AssembleMessages → CompactMessages → RunModelTurn → PersistTurn` (`packages/core/src/chat-pipeline/`, `turn-runtime.ts`, `transcript-reducer.ts`). Query+Tool loops are fused inside `RunModelTurnNode` (AI SDK `streamText`, ≤12 steps). See [`docs/chat-pipeline.md`](docs/chat-pipeline.md).
- Flows: named SQLite-backed pipelines (`flows`/`flow_runs` tables in `chat.sqlite`), nodes `tool_executor`/`llm_prompter`, not the chat pipeline. See [`docs/flows.md`](docs/flows.md).
- Global tools: `webSearch` (Perplexity via AI Gateway), `getWeather` (Open-Meteo + Nominatim), `fetchWebContent`, `readPdf`, `getMyLocation` (CoreLocation via native API). See docs per tool.
- Recording: single capture impl in Toby.app (`NativeAudioHandler`), both CLI/daemon and app routes write `~/.toby/listen/recordings/<id>/`; transcription via AI SDK. See [`docs/listen.md`](docs/listen.md).

## Conventions for agents

- **All new plugins must be TypeScript bun-package plugins** (`manifest.json` +
  TypeScript entry, run via bundled Bun). Do not create compiled binary or Swift
  plugins. The only native macOS product code in-repo is Toby.app
  (`apps/toby-app/`). For EventKit / Shortcuts / TCC, delegate to Toby.app's
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
  `bun run test` (and Swift tests when touching Toby.app). Use `bunx biome check`
  with the repo's `biome.json` — do not introduce ESLint/Prettier.
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
- **Native UI work:** before changing anything visible in `apps/toby-app`, read
  [`DESIGN.md`](DESIGN.md) and invoke [`toby-design`](.agents/skills/toby-design/).
  Reuse `AppTheme`, `SettingsDesign`, existing primitives, and native macOS
  controls before creating local styling or a new abstraction. Treat current
  SwiftUI source as authoritative over Figma/reference specimens. For windows,
  title-bar chrome, sidebars, Settings, or modal windows, also invoke
  [`toby-native-window`](.agents/skills/toby-native-window/).
- **Dev loops:** `bun run dev` / `bun run app` build and open the native app (`scripts/build-app.sh` → `dist/Toby (Dev).app`); `bun run dev:turbo` watches the CLI via Turbo; daemon dev helpers are `bun run start:server`/`stop:server`/`restart:server` (`TOBY_PLUGINS_DIR=$PWD/dist`). Do not expect an Ink chat TUI — interactive UI is Toby.app only.
- **Gotchas:** Never hardcode `~/.toby` paths; never read `credentials.json` without `readCredentials`; never add `BUILTIN_MODULES` entries for new integrations; never `npm install`; never create `apps/toby-app` code that imports `@toby/core`.

## Skills

| Skill | When to use |
| ----- | ----------- |
| [`toby-plugin`](.agents/skills/toby-plugin/) / [`toby-ts-plugin`](.agents/skills/toby-ts-plugin/) | New plugin or migration to bun-package (`manifest.json`, protocol, discovery, release wiring) |
| [`toby-docs`](.agents/skills/toby-docs/) | Any user-visible or contributor-doc change (sync `docs/` + `apps/help-site/docs/`) |
| [`bun-test-runner`](.agents/skills/bun-test-runner/) | Writing TS tests (`bun:test`, `describe`/`it`/`expect`/`mock`, `skipIf`) |
| [`atomic-conventional-commit`](.agents/skills/atomic-conventional-commit/) | Commits (`feat`/`fix`/`docs`/`refactor`/`test`/`chore`, atomic per feature/bug) |
| [`release-toby`](.agents/skills/release-toby/) | Releases (`release-it`, archives, DMG, installer, self-upgrade) |
| [`toby-design`](.agents/skills/toby-design/) | Required for native UI work: source-backed design contract, component/state recipes, Figma map, prototypes, mocks |
| [`toby-screenshot-docs`](.agents/skills/toby-screenshot-docs/) | Native UI screenshots for help-site (`apps/help-site/static/img/`) |
| `resolve-github-issue` | End-to-end GitHub issue resolution (`gh`, plan in spec mode) |
| Swift pipeline (below) | SwiftUI/macOS reviews |
| Reference only: [`swiftui-pro`](.agents/skills/swiftui-pro/), [`swiftui-expert-skill`](.agents/skills/swiftui-expert-skill/), [`toby-native-window`](.agents/skills/toby-native-window/) | Deep SwiftUI topic refs, Instruments, window chrome |

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
| [`docs/dashboard-standard-tools-plan.md`](docs/dashboard-standard-tools-plan.md) | Dashboard standard-tool contract, merge rules, plugin checklist. |
| [`docs/chat-inbound.md`](docs/chat-inbound.md) | Inbound provider contract; external session keys; Slack thread/DM mapping. |
| [`docs/ai-caching.md`](docs/ai-caching.md) | Provider prompt caching and token telemetry. |
| [`docs/memory.md`](docs/memory.md) | Durable user memory (`memory.sqlite`). |
| [`docs/macos-integration.md`](docs/macos-integration.md) | `toby-plugin-macos` system control via Toby.app native API. |
| [`docs/news.md`](docs/news.md) | News plugin via Hacker News and The Guardian. |
| [`docs/apple-calendar.md`](docs/apple-calendar.md) | Apple Calendar plugin + EventKit native API. |
| [`docs/apple-contacts.md`](docs/apple-contacts.md) | Apple Contacts plugin. |
| [`docs/apple-reminders.md`](docs/apple-reminders.md) | Apple Reminders plugin. |
| [`docs/web-search.md`](docs/web-search.md) | Global `webSearch` via AI Gateway Perplexity. |
| [`docs/pdf-read.md`](docs/pdf-read.md) | Global `readPdf` tool: extract PDF text into chat context. |
| [`docs/weather.md`](docs/weather.md) | Global `getWeather` via Open-Meteo + Nominatim. |
| [`docs/location.md`](docs/location.md) | Global `getMyLocation` via Toby.app CoreLocation. |
| [`docs/listen.md`](docs/listen.md) | Recording / transcription lifecycle. |
| [`docs/native-helpers.md`](docs/native-helpers.md) | Toby.app native API pattern for platform bridges. |
| [`docs/build-executable.md`](docs/build-executable.md) | Bun compile binary and release packaging. |
| [`docs/image-generation-plan.md`](docs/image-generation-plan.md) | Unimplemented plan: capability-gated `generateImage` tool. |
| [`docs/README.md`](docs/README.md) | Full docs index. |

## Quick paths

- CLI entry: [`apps/cli/src/cli.ts`](apps/cli/src/cli.ts)
- CLI commands: [`apps/cli/src/commands/`](apps/cli/src/commands/)
- Harness (`@toby/core`): [`packages/core/src/`](packages/core/src/)
- Core config/data: [`packages/core/src/config/index.ts`](packages/core/src/config/index.ts) (`resolveTobyDir`, `getConfigPath`, `readCredentials`, `chat.sqlite`, `memory.sqlite`, `logs/toby.log`)
- Chat pipeline: [`packages/core/src/chat-pipeline/pipeline.ts`](packages/core/src/chat-pipeline/pipeline.ts) (`nodes/`, `turn-runtime.ts`, `transcript-reducer.ts`)
- Session store: [`packages/core/src/session-store.ts`](packages/core/src/session-store.ts)
- Integration types: [`packages/core/src/integrations/types.ts`](packages/core/src/integrations/types.ts)
- Integration registry: [`packages/core/src/integrations/index.ts`](packages/core/src/integrations/index.ts)
- Plugin runtime: [`packages/core/src/integrations/plugins/`](packages/core/src/integrations/plugins/) (`registry.ts`, `client.ts`, `inbound-adapter.ts`)
- Personas: [`packages/core/src/personas/`](packages/core/src/personas/)
- Skills: [`packages/core/src/skills/`](packages/core/src/skills/) + user `~/.toby/skills/`
- Memory: [`packages/core/src/memory/`](packages/core/src/memory/)
- Projects: [`packages/core/src/projects/`](packages/core/src/projects/)
- Flows: [`packages/core/src/flows/`](packages/core/src/flows/)
- Daemon: [`packages/core/src/daemon/`](packages/core/src/daemon/) + [`docs/daemon.md`](docs/daemon.md)
- Native app: [`apps/toby-app/`](apps/toby-app/) (`Sources/TobyApp/Native/`, `Sources/TobyApp/Features/`, `Tests/`)
- Plugin example: [`apps/plugin-sample-ts/`](apps/plugin-sample-ts/) (`manifest.json`, `src/index.ts`)
- Help site: [`apps/help-site/`](apps/help-site/) (`docs/`, `static/img/`)
- Build/release: [`scripts/build-app.sh`](scripts/build-app.sh), [`scripts/build-release-artifacts.sh`](scripts/build-release-artifacts.sh), [`scripts/build-dmg.sh`](scripts/build-dmg.sh)
- Config: `package.json` (workspaces, scripts), `turbo.json`, `biome.json`, `knip.json`, `tsconfig.base.json`
