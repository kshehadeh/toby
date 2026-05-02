# Agent and contributor guide

This repository is **Toby**, a CLI for personal productivity (integrations such as Gmail and Todoist, AI-assisted flows, and an Ink-based configure UI). Use **Bun** for installs and scripts (`bun install`, `bun run …`).

Use this file as the **entry point** for orientation. Detailed design lives under [`docs/`](docs/).

## Documentation index

| Document | Purpose |
| -------- | ------- |
| [`docs/architecture.md`](docs/architecture.md) | Repository layout, runtime entrypoints, config storage, and how major layers interact. |
| [`docs/integrations.md`](docs/integrations.md) | Plugin-style integrations: `IntegrationModule`, registry, capabilities, credentials, and CLI contributions. |
| [`docs/create-integration.md`](docs/create-integration.md) | Checklist for adding a new first-party integration module. |
| [`docs/chat-pipeline.md`](docs/chat-pipeline.md) | `toby chat` message flow, prompt caching strategy, and tool-result caching behavior. |
| [`docs/apple-mail.md`](docs/apple-mail.md) | Apple Mail (macOS): local Mail.app integration and automation permissions. |
| [`docs/build-executable.md`](docs/build-executable.md) | Optional **Bun** single-file `dist/toby` binary (`bun run build:executable`). |
| [`docs/README.md`](docs/README.md) | Short index of everything in `docs/`. |

## Conventions for agents

- Prefer **integration-local** code under `src/integrations/<name>/` (client, prompts, tools, CLI) over new cross-cutting branches in `src/commands/` when the behavior belongs to one integration.
- **Register** new integrations in [`src/integrations/index.ts`](src/integrations/index.ts) (`MODULES` array).
- **Shared** commands (`connect`, `disconnect`, `status`, `summarize`, `organize`, `chat`, `configure`) live in [`src/commands/`](src/commands/) and should stay generic; they resolve behavior through the registry and module hooks.
- After substantive changes, run `bun run lint`, `bun run typecheck`, and `bun run test`.

## Quick paths

- CLI entry: [`src/cli.ts`](src/cli.ts)
- Integration types: [`src/integrations/types.ts`](src/integrations/types.ts)
- Integration registry: [`src/integrations/index.ts`](src/integrations/index.ts)
- User config and credentials: [`src/config/index.ts`](src/config/index.ts) (paths under `~/.toby/`, including optional `~/.toby/skills/` for `SKILL.md` skills)
