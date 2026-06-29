# Agent and contributor guide

This repository is **Toby**, a CLI for personal productivity (integrations such as Email and Todoist, AI-assisted flows, and an Ink-based configure UI). The repo is a **Bun monorepo**: shared harness code lives in **`@toby/core`**, and the Ink/Commander front-end lives in **`@toby/cli`**. Use **Bun** for installs and scripts (`bun install`, `bun run …`).

Use this file as the **entry point** for orientation. Detailed design lives under [`docs/`](docs/), especially [`docs/architecture.md`](docs/architecture.md) for the core vs app split.

## Documentation index

| Document | Purpose |
| -------- | ------- |
| [`docs/architecture.md`](docs/architecture.md) | Repository layout, runtime entrypoints, config storage, and how major layers interact. |
| [`docs/recent-changes-2026-06-12-to-18.md`](docs/recent-changes-2026-06-12-to-18.md) | Dated summary of major native app, recording, daemon, project, AI, plugin, and chat changes from June 12–18, 2026. |
| [`docs/integrations.md`](docs/integrations.md) | Plugin-style integrations: `IntegrationModule`, registry, capabilities, credentials, and CLI contributions. |
| [`docs/plugin-protocol.md`](docs/plugin-protocol.md) | Installable plugin executables: subcommand contract, discovery, JSON protocol v1. |
| [`docs/create-integration.md`](docs/create-integration.md) | Checklist for adding a new first-party integration module. |
| [`docs/chat-pipeline.md`](docs/chat-pipeline.md) | Chat turn node pipeline, `ChatEvent` observability, and tool-result caching. |
| [`docs/projects.md`](docs/projects.md) | Projects: scoped artifact collection with reference context, pinned skills, and recurring workflow support. |
| [`docs/daemon.md`](docs/daemon.md) | Background daemon: schedules, chat inbound (@mentions), `daemon.log`, troubleshooting. |
| [`docs/server-api.md`](docs/server-api.md) | Local daemon HTTP API reference: routes, request/response shapes, SSE chat turns, configure actions. |
| [`docs/chat-inbound.md`](docs/chat-inbound.md) | Inbound provider contract, external session mapping, adding new chat platforms. |
| [`docs/ai-caching.md`](docs/ai-caching.md) | Provider prompt caching adapters, stable cache keys, and token telemetry. |
| [`docs/ui.md`](docs/ui.md) | Shared Ink UI components, visual conventions, and shortcut conventions. |
| [`docs/macos-integration.md`](docs/macos-integration.md) | Local macOS system control: Wi‑Fi, battery/audio, shortcuts, optional Homebrew helpers. |
| [`docs/web-search.md`](docs/web-search.md) | Web Search via AI Gateway Perplexity: built-in global `webSearch` tool, config. |
| [`docs/listen.md`](docs/listen.md) | Foreground audio recording mode and macOS audio helper protocol. |
| [`docs/native-helpers.md`](docs/native-helpers.md) | Pattern for adding native helper executables that bridge Toby to platform APIs. |
| [`docs/build-executable.md`](docs/build-executable.md) | Optional **Bun** single-file `dist/toby` binary (`bun run build:executable`). |
| [`docs/README.md`](docs/README.md) | Short index of everything in `docs/`. |

## Core vs CLI (`@toby/core` vs `apps/cli`)

Put code in **`packages/core`** when it is **harness functionality** — usable without Ink, React, or Commander:

| Belongs in `@toby/core` | Belongs in `apps/cli` |
| ----------------------- | --------------------- |
| Chat pipeline (`runChatTurnPipeline`, nodes, headless sessions) | Ink/React TUI (`ui/chat/`, `ui/configure/`, …) |
| AI layer (models, tools, pretreatment, caching, replay) | Commander wiring (`cli.ts`, generic `commands/`) |
| Integrations (registry, clients, tools, prompts, inbound) | Slash commands, transcript rendering, chat event → row reducers |
| Config, personas, skills, memory, planning, logging | `listen/`, `schedules/` orchestration UI, `upgrade/`, `releases/` |
| SQLite session store, message prep, chat-integration resolution | Shared Ink primitives (`ui/shared/`) |

**Dependency rule:** `apps/cli` imports `@toby/core`; core must **not** import from `apps/cli` (no `ui/`, `commands/`, or Ink).

**Imports:** In the CLI app, use `@toby/core/...` (e.g. `@toby/core/chat-pipeline/pipeline`, `@toby/core/config/index`). Core stays on relative imports internally.

**Tests:** CLI tests remain under `apps/cli/tests/` but should import harness code from `@toby/core`, not deleted `apps/cli/src/ai` paths.

When unsure: if the daemon or a headless script could call it without a terminal UI, it belongs in core.

## Conventions for agents

- **All new plugins must be TypeScript bun-package plugins** (directory with `manifest.json` + TypeScript entrypoint, executed via Toby's bundled Bun runtime). Do not create compiled binary or Swift plugins. The only native macOS code in this repository is the Toby.app itself (`apps/toby-app/`). When a plugin needs macOS framework access (EventKit, Shortcuts, system APIs, TCC-protected resources), the TypeScript plugin delegates those operations to Toby.app's native API server rather than compiling its own native binary. See [`toby-plugin-macos`](apps/plugin-macos/) and [`toby-plugin-applecalendar`](apps/plugin-applecalendar/) for reference.
- Prefer **integration-local** code under `packages/core/src/integrations/<name>/` (client, prompts, tools; optional `cli.ts` for integration subcommands) over new cross-cutting branches in `apps/cli/src/commands/` when the behavior belongs to one integration.
- **Register** new integrations in [`packages/core/src/integrations/index.ts`](packages/core/src/integrations/index.ts) (`MODULES` array).
- **Shared** commands (`connect`, `disconnect`, `status`, `summarize`, `organize`, `chat`, `configure`) live in [`apps/cli/src/commands/`](apps/cli/src/commands/) and should stay generic; they resolve behavior through the core registry and module hooks.
- After substantive changes, run `bun run lint`, `bun run typecheck`, and `bun run test`.
- When committing changes, use the `atomic-conventional-commit` skill so commits are cohesive, reviewable, and follow Conventional Commit messages.
- Use `bun run dev` for the Ink chat TUI (runs the CLI directly; do not use `dev:turbo` — Turborepo log prefixes break the TUI).
- Use shared UI primitives from `apps/cli/src/ui/shared/` (`ViewFrame`, `ViewModal`, `ConfirmDialog`, `FieldNavigator`, `FieldEditor`, `FieldSelector`, `UI_GLYPHS`, row components, key predicates) when building Ink views. Do not create local frame/dialog/key/glyph duplicates. See [`docs/ui.md`](docs/ui.md).

## Quick paths

- CLI entry: [`apps/cli/src/cli.ts`](apps/cli/src/cli.ts)
- Harness core (`@toby/core`): chat pipeline, AI, integrations, config — [`packages/core/src/`](packages/core/src/)
- Integration types: [`packages/core/src/integrations/types.ts`](packages/core/src/integrations/types.ts)
- Integration registry: [`packages/core/src/integrations/index.ts`](packages/core/src/integrations/index.ts)
- User config and credentials: [`packages/core/src/config/index.ts`](packages/core/src/config/index.ts) (paths under `~/.toby/`, including optional `~/.toby/skills/` for `SKILL.md` skills)
