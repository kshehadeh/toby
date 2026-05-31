# Architecture

Toby is a **Commander.js** CLI distributed as the `toby` package binary. The codebase favors a **plugin-first integration model**: each integration is a self-contained module under `src/integrations/<name>/`, registered in a central list and discovered by capability.

## High-level layout

```
src/
  cli.ts                 # Program entry: registers shared + integration commands
  commands/              # Cross-integration CLI commands (connect, summarize, chat, …)
  integrations/          # Integration modules + registry (see integrations.md)
    index.ts             # MODULES registry and lookup helpers
    types.ts             # Integration, IntegrationModule, capabilities, descriptors
    gmail/
    todoist/
  config/                # Read/write ~/.toby/config.json and credentials.json
  ai/                    # Shared AI helpers (chat, providers) — not integration-specific
  chat-pipeline/         # Node pipeline (turn init → expand → assemble → run → persist), tool cache, chat events, headless sessions
  chat-inbound/          # Provider-agnostic daemon inbound router (integrations implement chatInbound)
  personas/              # Named personas (model + instructions) used by AI flows
  ui/configure/          # Ink/React TUI for `toby configure`
  ui/chat/               # Ink TUI for `toby chat` when no prompt is passed on the CLI
```

**Tests** live in `tests/` (Vitest).

**Build**

- **`bun run build`** — `tsup` emits `dist/cli.js` (the `package.json` `"bin"` entry).
- **`bun run build:executable`** — optional single-file native binary via `bun build --compile` (see [build-executable.md](build-executable.md)).

## Runtime flow

1. **`src/cli.ts`** constructs the Commander program, registers built-in commands, then calls `registerCommands` on each loaded `IntegrationModule` (if present). When no subcommand is provided on the command line, `chat` is used as the default (implemented by prepending `"chat"` to the args before parsing if the first arg is not a known subcommand or root option like `--help`/`--version`).
2. **Connect / disconnect / status** use [`getIntegration`](../src/integrations/index.ts) or [`getIntegrations`](../src/integrations/index.ts) to invoke lifecycle and health checks on the right module.
3. **`summarize`** resolves a module by name, checks the `summarize` capability, calls `module.summarize(...)`, then runs the AI SDK with returned messages.
4. **`chat`** (`src/commands/chat.ts`) resolves one or more connected integrations (positional / `--integration` / default all), then runs an Ink multi-turn session or `--no-tui` console flow. Each turn is orchestrated by [`runChatTurnPipeline`](../src/chat-pipeline/pipeline.ts) (five chained nodes: init, expand prompt, assemble messages, run model turn, persist). Tool merging, prompt caching, and abort handling live inside **RunModelTurnNode** via [`run-turn.ts`](../src/chat-pipeline/run-turn.ts) and [`chat.ts`](../src/ai/chat.ts) (see [`ask-user-tool.ts`](../src/ai/ask-user-tool.ts)).
5. **`config`** is the primary settings command. `toby config` launches the configure UI, while `toby config backup` and `toby config restore` manage encrypted config backups. `toby configure` remains as a compatibility alias.

## Local data

| Location | Role |
| -------- | ---- |
| `~/.toby/config.json` | Integration connection flags, personas |
| `~/.toby/credentials.json` | API keys, OAuth client secrets, OpenAI token |
| `~/.toby/chat.sqlite` | Chat session storage (sessions, messages, transcript) |
| `~/.toby/toby.log` | JSON-lines chat session log (turns, tools, prep) |
| `~/.toby/daemon.log` | JSON-lines daemon log (scheduler, inbound chat, Slack Socket Mode) |

Access is centralized in [`src/config/index.ts`](../src/config/index.ts). Integration modules should not hardcode paths; use the config helpers.

Backup and restore behavior is documented in [`commands.md`](commands.md).

## UI stack

All Ink/React views share a set of primitives in [`src/ui/shared/`](../src/ui/shared/):
`ViewFrame` (standalone app frames), `ViewModal` (chat overlay frames),
`ConfirmDialog`, `MultilineTextEdit`, row components (`InfoRow`, `ActionRow`,
`SelectableTextRow`, `SectionDivider`, `StatusIcon`), key predicates
(`src/ui/shared/keybindings.ts`), and glyph constants
(`src/ui/shared/glyphs.ts`). See [`docs/ui.md`](ui.md) for conventions.

The configure flow uses **Ink** and **React** (`src/ui/configure/`). The tree structure for the TUI is built in [`src/ui/configure/items.ts`](../src/ui/configure/items.ts), which pulls integration credential sections from the integration registry.

For `toby chat`, slash commands are registered in
[`src/ui/chat/slash-commands/`](../src/ui/chat/slash-commands/), and the same
registry powers autocomplete, execution, and help text (see
[`docs/slash-commands.md`](slash-commands.md)).

## AI stack

Shared pieces live under `src/ai/`:

- [`model-factory.ts`](../src/ai/model-factory.ts) — creates AI SDK language models from persona config (OpenAI direct, Vercel AI Gateway, and future providers).
- [`chat.ts`](../src/ai/chat.ts) — tool-assisted chat helpers used by Gmail organize, `toby chat`, and similar flows.
- [`ask-user-tool.ts`](../src/ai/ask-user-tool.ts) — shared **Ask User** tool merged into tool maps; optional handler for Ink (`toby chat` session) vs readline (`organize`, `--no-tui` chat).
- [`ui/chat/session.tsx`](../src/ui/chat/session.tsx) — multi-turn Ink chat: keeps provider message history and wires `askUser` into the TUI.
- [`providers.ts`](../src/ai/providers.ts) — provider/model lists for the configure UI.

Integration-specific **prompts** and **tool definitions** should live next to the integration (e.g. `src/integrations/gmail/prompts/`, `tools.ts`) so the core stays integration-agnostic.
