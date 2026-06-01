# Agent and contributor guide

This repository is **Toby**, a CLI for personal productivity (integrations such as Gmail and Todoist, AI-assisted flows, and an Ink-based configure UI). Use **Bun** for installs and scripts (`bun install`, `bun run …`).

Use this file as the **entry point** for orientation. Detailed design lives under [`docs/`](docs/).

## Documentation index

| Document | Purpose |
| -------- | ------- |
| [`docs/architecture.md`](docs/architecture.md) | Repository layout, runtime entrypoints, config storage, and how major layers interact. |
| [`docs/integrations.md`](docs/integrations.md) | Plugin-style integrations: `IntegrationModule`, registry, capabilities, credentials, and CLI contributions. |
| [`docs/plugin-protocol.md`](docs/plugin-protocol.md) | Installable plugin executables: subcommand contract, discovery, JSON protocol v1. |
| [`docs/create-integration.md`](docs/create-integration.md) | Checklist for adding a new first-party integration module. |
| [`docs/chat-pipeline.md`](docs/chat-pipeline.md) | Chat turn node pipeline, `ChatEvent` observability, and tool-result caching. |
| [`docs/daemon.md`](docs/daemon.md) | Background daemon: schedules, chat inbound (@mentions), `daemon.log`, troubleshooting. |
| [`docs/chat-inbound.md`](docs/chat-inbound.md) | Inbound provider contract, external session mapping, adding new chat platforms. |
| [`docs/ai-caching.md`](docs/ai-caching.md) | Provider prompt caching adapters, stable cache keys, and token telemetry. |
| [`docs/ui.md`](docs/ui.md) | Shared Ink UI components, visual conventions, and shortcut conventions. |
| [`docs/apple-mail.md`](docs/apple-mail.md) | Apple Mail (macOS): local Mail.app integration and automation permissions. |
| [`docs/macos-integration.md`](docs/macos-integration.md) | Local macOS system control: Wi‑Fi, battery/audio, shortcuts, optional Homebrew helpers. |
| [`docs/listen.md`](docs/listen.md) | Foreground audio recording mode and macOS audio helper protocol. |
| [`docs/native-helpers.md`](docs/native-helpers.md) | Pattern for adding native helper executables that bridge Toby to platform APIs. |
| [`docs/build-executable.md`](docs/build-executable.md) | Optional **Bun** single-file `dist/toby` binary (`bun run build:executable`). |
| [`docs/README.md`](docs/README.md) | Short index of everything in `docs/`. |

## Conventions for agents

- Prefer **integration-local** code under `apps/cli/src/integrations/<name>/` (client, prompts, tools, CLI) over new cross-cutting branches in `apps/cli/src/commands/` when the behavior belongs to one integration.
- **Register** new integrations in [`apps/cli/src/integrations/index.ts`](apps/cli/src/integrations/index.ts) (`MODULES` array).
- **Shared** commands (`connect`, `disconnect`, `status`, `summarize`, `organize`, `chat`, `configure`) live in [`apps/cli/src/commands/`](apps/cli/src/commands/) and should stay generic; they resolve behavior through the registry and module hooks.
- After substantive changes, run `bun run lint`, `bun run typecheck`, and `bun run test`.
- Use `bun run dev` for the Ink chat TUI (runs the CLI directly; do not use `dev:turbo` — Turborepo log prefixes break the TUI).
- Use shared UI primitives from `apps/cli/src/ui/shared/` (`ViewFrame`, `ViewModal`, `ConfirmDialog`, `FieldNavigator`, `FieldEditor`, `FieldSelector`, `UI_GLYPHS`, row components, key predicates) when building Ink views. Do not create local frame/dialog/key/glyph duplicates. See [`docs/ui.md`](docs/ui.md).

## Quick paths

- CLI entry: [`apps/cli/src/cli.ts`](apps/cli/src/cli.ts)
- Integration types: [`apps/cli/src/integrations/types.ts`](apps/cli/src/integrations/types.ts)
- Integration registry: [`apps/cli/src/integrations/index.ts`](apps/cli/src/integrations/index.ts)
- User config and credentials: [`apps/cli/src/config/index.ts`](apps/cli/src/config/index.ts) (paths under `~/.toby/`, including optional `~/.toby/skills/` for `SKILL.md` skills)
