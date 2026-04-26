# Integrations

Integrations are **first-party plugins**: each is an object implementing `IntegrationModule`, registered in [`src/integrations/index.ts`](../src/integrations/index.ts).

## Types (`src/integrations/types.ts`)

### `Integration`

Baseline contract every integration satisfies:

- Identity: `name`, `displayName`, `description`
- Lifecycle: `connect`, `disconnect`, `isConnected`, `testConnection`

`testConnection` returns `IntegrationHealth`, optionally including per-tool rows (`IntegrationToolHealth`) for `status integration`.

### `IntegrationModule`

Extends `Integration` with optional **capabilities** and **hooks**:

| Field / method | Purpose |
| ---------------- | ------- |
| `capabilities` | Subset of `IntegrationCapability`: currently `"summarize"` \| `"organize"`. |
| `resources?` | Optional strings describing entities (e.g. inbox, tasks) for discovery or docs. |
| `getCredentialDescriptors()` | Fields shown under Integrations in configure UI (`CredentialFieldDescriptor`: flat `key`, `label`, `masked`, …). |
| `seedCredentialValues(creds)` | Populate the flat value map when opening configure. |
| `mergeCredentialsPatch(values, previous)` | Return a `Partial<CredentialsFile>` fragment when saving; configure merges patches from all modules. |
| `summarize?(options)` | Build `CoreMessage[]` (or return `empty`) for the shared `summarize` command. |
| `registerCommands?(program)` | Attach Commander subcommands (e.g. Gmail’s `gmail fetch`, `gmail organize`). |

Types such as `IntegrationModule` and `IntegrationCapability` are exported from [`types.ts`](../src/integrations/types.ts). Import them from there when you need them in implementation code; the barrel [`index.ts`](../src/integrations/index.ts) exposes runtime registry functions.

## Registry

[`src/integrations/index.ts`](../src/integrations/index.ts) holds the authoritative `MODULES` array.

| Function | Use |
| -------- | --- |
| `getIntegrationModules()` | All modules (full `IntegrationModule`). |
| `getIntegrationModule(name)` | Lookup by CLI name (`gmail`, `todoist`). |
| `getModulesWithCapability(cap)` | Filter by capability (e.g. all that support `summarize`). |
| `getIntegrations()` / `getIntegration(name)` | Same instances typed as `Integration` for lifecycle-only call sites. |

## Per-integration folder layout

Each integration typically owns:

- **`index.ts`** — exports `*IntegrationModule` constant wiring lifecycle, capabilities, credentials, `summarize`, `registerCommands`, and tool validation used by `testConnection`.
- **`client.ts`** — HTTP/API calls, typed DTOs.
- **`auth.ts`** (if OAuth) — OAuth helper used by `connect`.
- **`tools.ts`** — AI SDK `tool()` definitions and context types (module-private unless needed elsewhere).
- **`prompts/`** — System/user message builders for summarize, organize, etc.
- **`cli.ts`** (optional) — Commander registration kept out of `src/commands/`.

**Gmail** and **Todoist** under [`src/integrations/gmail/`](../src/integrations/gmail/) and [`src/integrations/todoist/`](../src/integrations/todoist/) are the reference implementations.

## How core commands use modules

- **`connect` / `disconnect`** — `getIntegration(name)` then lifecycle methods.
- **`status integration`** — `testConnection()`; modules return structured tool checks where applicable.
- **`summarize <integration>`** — `getIntegrationModule`, require `summarize` in `capabilities` and a defined `summarize` function, then AI generation on returned messages.
- **`configure`** — builds credential UI from `getCredentialDescriptors` across `getIntegrationModules()`, saves via each `mergeCredentialsPatch`.

Keeping this wiring generic avoids adding new `if (name === "…")` branches in core commands when a new integration is added.
