# Architecture

Toby is a **Commander.js** CLI packaged as an npm binary (`toby`). The codebase favors a **plugin-first integration model**: each integration is a self-contained module under `src/integrations/<name>/`, registered in a central list and discovered by capability.

## High-level layout

```
src/
  cli.ts                 # Program entry: registers shared + integration commands
  commands/              # Cross-integration CLI commands (connect, summarize, …)
  integrations/          # Integration modules + registry (see integrations.md)
    index.ts             # MODULES registry and lookup helpers
    types.ts             # Integration, IntegrationModule, capabilities, descriptors
    gmail/
    todoist/
  config/                # Read/write ~/.toby/config.json and credentials.json
  ai/                    # Shared AI helpers (chat, providers) — not integration-specific
  personas/              # Named personas (model + instructions) used by AI flows
  ui/configure/          # Ink/React TUI for `toby configure`
```

**Tests** live in `tests/` (Vitest).

**Build**

- **`npm run build`** — `tsup` emits `dist/cli.js` (the `package.json` `"bin"` target for Node).
- **`bun run build:executable`** — optional single-file native binary via `bun build --compile` (see [build-executable.md](build-executable.md)).

## Runtime flow

1. **`src/cli.ts`** constructs the Commander program, registers built-in commands, then calls `registerCommands` on each loaded `IntegrationModule` (if present).
2. **Connect / disconnect / status** use [`getIntegration`](../src/integrations/index.ts) or [`getIntegrations`](../src/integrations/index.ts) to invoke lifecycle and health checks on the right module.
3. **`summarize`** resolves a module by name, checks the `summarize` capability, calls `module.summarize(...)`, then runs the AI SDK with returned messages.
4. **`configure`** reads flat credential/persona values, builds the settings tree (integration sections come from each module’s credential descriptors), and writes merged credentials back through each module’s `mergeCredentialsPatch`.

## Local data

| Location | Role |
| -------- | ---- |
| `~/.toby/config.json` | Integration connection flags, personas |
| `~/.toby/credentials.json` | API keys, OAuth client secrets, OpenAI token |

Access is centralized in [`src/config/index.ts`](../src/config/index.ts). Integration modules should not hardcode paths; use the config helpers.

## UI stack

The configure flow uses **Ink** and **React** (`src/ui/configure/`). The tree structure for the TUI is built in [`src/ui/configure/items.ts`](../src/ui/configure/items.ts), which pulls integration credential sections from the integration registry.

## AI stack

Shared pieces live under `src/ai/`:

- [`chat.ts`](../src/ai/chat.ts) — model creation and tool-assisted chat helpers used by Gmail organize and similar flows.
- [`providers.ts`](../src/ai/providers.ts) — provider/model lists for the configure UI.

Integration-specific **prompts** and **tool definitions** should live next to the integration (e.g. `src/integrations/gmail/prompts/`, `tools.ts`) so the core stays integration-agnostic.
