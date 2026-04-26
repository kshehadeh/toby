# Architecture

Toby is a **Commander.js** CLI packaged as an npm binary (`toby`). The codebase favors a **plugin-first integration model**: each integration is a self-contained module under `src/integrations/<name>/`, registered in a central list and discovered by capability.

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
  personas/              # Named personas (model + instructions) used by AI flows
  ui/configure/          # Ink/React TUI for `toby configure`
  ui/chat/               # Ink TUI for `toby chat` when no prompt is passed on the CLI
```

**Tests** live in `tests/` (Vitest).

**Build**

- **`npm run build`** — `tsup` emits `dist/cli.js` (the `package.json` `"bin"` target for Node).
- **`bun run build:executable`** — optional single-file native binary via `bun build --compile` (see [build-executable.md](build-executable.md)).

## Runtime flow

1. **`src/cli.ts`** constructs the Commander program, registers built-in commands, then calls `registerCommands` on each loaded `IntegrationModule` (if present).
2. **Connect / disconnect / status** use [`getIntegration`](../src/integrations/index.ts) or [`getIntegrations`](../src/integrations/index.ts) to invoke lifecycle and health checks on the right module.
3. **`summarize`** resolves a module by name, checks the `summarize` capability, calls `module.summarize(...)`, then runs the AI SDK with returned messages.
4. **`chat`** (`src/commands/chat.ts`) resolves one or more connected integrations (positional / `--integration` / default all), then runs an Ink multi-turn session or `--no-tui` console flow; multi-integration turns merge tool maps in [`src/ui/chat/run-turn.ts`](../src/ui/chat/run-turn.ts) (see [`src/ai/chat.ts`](../src/ai/chat.ts) and [`src/ai/ask-user-tool.ts`](../src/ai/ask-user-tool.ts)).
5. **`configure`** reads flat credential/persona values, builds the settings tree (integration sections come from each module’s credential descriptors), and writes merged credentials back through each module’s `mergeCredentialsPatch`.

## Local data

| Location | Role |
| -------- | ---- |
| `~/.toby/config.json` | Integration connection flags, personas |
| `~/.toby/credentials.json` | API keys, OAuth client secrets, OpenAI token |
| `~/.toby/chat.sqlite` | Chat session storage (sessions, messages, transcript) |

Access is centralized in [`src/config/index.ts`](../src/config/index.ts). Integration modules should not hardcode paths; use the config helpers.

## UI stack

The configure flow uses **Ink** and **React** (`src/ui/configure/`). The tree structure for the TUI is built in [`src/ui/configure/items.ts`](../src/ui/configure/items.ts), which pulls integration credential sections from the integration registry.

For `toby chat`, slash commands are registered in
[`src/ui/chat/slash-commands/`](../src/ui/chat/slash-commands/), and the same
registry powers autocomplete, execution, and help text (see
[`docs/slash-commands.md`](slash-commands.md)).

## AI stack

Shared pieces live under `src/ai/`:

- [`chat.ts`](../src/ai/chat.ts) (under `src/ai/`) — model creation and tool-assisted chat helpers used by Gmail organize, `toby chat`, and similar flows.
- [`ask-user-tool.ts`](../src/ai/ask-user-tool.ts) — shared **Ask User** tool merged into tool maps; optional handler for Ink (`toby chat` session) vs readline (`organize`, `--no-tui` chat).
- [`ui/chat/session.tsx`](../src/ui/chat/session.tsx) — multi-turn Ink chat: keeps provider message history and wires `askUser` into the TUI.
- [`providers.ts`](../src/ai/providers.ts) — provider/model lists for the configure UI.

Integration-specific **prompts** and **tool definitions** should live next to the integration (e.g. `src/integrations/gmail/prompts/`, `tools.ts`) so the core stays integration-agnostic.
