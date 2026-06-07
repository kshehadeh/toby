# Integrations

Integrations are **first-party plugins** in **`@toby/core`**: each is an object implementing `IntegrationModule`, registered in [`packages/core/src/integrations/index.ts`](../packages/core/src/integrations/index.ts). The CLI app loads the registry and may add Ink-specific UX; integration behavior itself lives in core. See [`architecture.md`](architecture.md#core-vs-apps).

## Types (`packages/core/src/integrations/types.ts`)

### `Integration`

Baseline contract every integration satisfies:

- Identity: `name`, `displayName`, `description`
- Lifecycle: `connect`, `disconnect`, `isConnected`, `testConnection`

`testConnection` returns `IntegrationHealth`, optionally including per-tool rows (`IntegrationToolHealth`) for `status integration`.

### `IntegrationModule`

Extends `Integration` with optional **capabilities** and **hooks**:

| Field / method | Purpose |
| ---------------- | ------- |
| `capabilities` | Subset of `IntegrationCapability` (currently `"chat"`). |
| `providerCategories?` | Provider buckets for default-provider selection and schedule routing: `"email"` \| `"calendar"` \| `"tasks"` \| `"contacts"` \| `"chat"` \| `"search"` \| `"work_tracker"`. |
| `authMethods?` | Optional supported auth options for configure UI (e.g. OAuth vs client credentials) with a default method. |
| `resources?` | Optional strings describing entities (e.g. inbox, tasks) for discovery or docs. |
| `getCredentialDescriptors()` | Fields shown under Integrations in configure UI (`CredentialFieldDescriptor`: flat `key`, `label`, `masked`, plus optional auth-method gating via `showForAuthMethods`). |
| `seedCredentialValues(creds)` | Populate the flat value map when opening configure. |
| `mergeCredentialsPatch(values, previous)` | Return a `Partial<CredentialsFile>` fragment when saving; configure merges patches from all modules. |
| `summarize?(options)` | Build `CoreMessage[]` (or return `empty`) for the shared `summarize` command. |
| `chat?(options)` | Run the shared `chat` command: tool-calling AI for a user-supplied instruction (`ChatRunOptions`). |
| `createChatTools?(params)` | Provide tools + action accumulator for **RunModelTurnNode** (`runSharedChatTurn` in `packages/core/src/chat-pipeline/run-turn.ts`). |
| `registerCommands?(program)` | Attach Commander subcommands (e.g. Gmail’s `gmail fetch`, `gmail organize`). |
| `chatInbound?` | Long-lived inbound listener for the daemon (`ChatInboundProvider`); maps external channel+thread to chat sessions. See [`chat-inbound.md`](chat-inbound.md). |

Types such as `IntegrationModule` and `IntegrationCapability` are exported from [`types.ts`](../packages/core/src/integrations/types.ts). Import them from there when you need them in implementation code; the barrel [`index.ts`](../packages/core/src/integrations/index.ts) exposes runtime registry functions.

## Registry

[`packages/core/src/integrations/index.ts`](../packages/core/src/integrations/index.ts) holds the authoritative `MODULES` array.

| Function | Use |
| -------- | --- |
| `getIntegrationModules()` | All modules (full `IntegrationModule`). |
| `getIntegrationModule(name)` | Lookup by CLI name (`gmail`, `todoist`). |
| `getModulesWithCapability(cap)` | Filter by capability (e.g. all that support `summarize`). |
| `getIntegrations()` / `getIntegration(name)` | Same instances typed as `Integration` for lifecycle-only call sites. |

## Per-integration folder layout

Each integration typically owns:

- **`index.ts`** — exports `*IntegrationModule` constant wiring lifecycle, capabilities, credentials, `summarize`, optional `chat`, `createChatTools`, `registerCommands`, and tool validation used by `testConnection`. Chat turn execution is delegated to the shared `runSharedChatTurn` from `packages/core/src/chat-pipeline/run-turn.ts` (no per-integration `chat-turn.ts` needed).
- **`client.ts`** — HTTP/API calls, typed DTOs.
- **`auth.ts`** (if OAuth) — OAuth helper used by `connect`.
- **`tools.ts`** — AI SDK `tool()` definitions and context types (module-private unless needed elsewhere).
- **`prompts/`** — System/user message builders for summarize, organize, etc.
- **`cli.ts`** (optional) — Commander registration kept out of `apps/cli/src/commands/`.

**Gmail** and **Todoist** are shipped as installable Bun plugins (`toby-plugin-gmail`, `toby-plugin-todoist`); see [`apps/plugin-gmail/`](../apps/plugin-gmail/) and [`apps/plugin-todoist/`](../apps/plugin-todoist/).

**Slack** ([`packages/core/src/integrations/slack/`](../packages/core/src/integrations/slack/)) is a representative built-in chat integration: OAuth (PKCE + user scopes on localhost) or manual bot token auth, with chat tools to search channels/users, post messages, reply in threads, and search message history. **Daemon inbound** (@mentions via Socket Mode) always requires a **bot token** (`xoxb-…`) and **app token** (`xapp-…`) in addition to OAuth user credentials—see [help-site Slack credentials](../apps/help-site/docs/integrations/slack.md#credentials-and-auth-reference).

**macOS** is shipped as a Swift installable plugin (`toby-plugin-macos`); see [`apps/plugin-macos/`](../apps/plugin-macos/) and [`macos-integration.md`](macos-integration.md). It is **macOS-only** and controls local system settings (Wi‑Fi, Bluetooth, battery, audio, display, clipboard, shortcuts) via native frameworks in-process.

**Apple Calendar** is shipped as a Swift installable plugin (`toby-plugin-applecalendar`); see [`apps/plugin-applecalendar/`](../apps/plugin-applecalendar/) and [`apple-calendar.md`](apple-calendar.md). It is **macOS-only** and uses native **EventKit** for search and CRUD, with Calendar.app AppleScript fallbacks when needed.

**Web Search** ([`apps/plugin-websearch/`](../apps/plugin-websearch/), [`web-search.md`](web-search.md)) is the **Search** provider category integration (Swift plugin, Brave Search API backend): API-key auth, with a `webSearch` chat tool for web search (query, count, freshness filter). The `webSearch` tool is also wired as a **conditional global tool** — when the plugin is installed and a Brave Search API key is present in credentials, the tool is available in every chat session without needing to explicitly select the integration. Migrated from the former built-in `bravesearch` integration.

**Jira** is shipped as a Swift installable plugin (`toby-plugin-jira`); see [`apps/plugin-jira/`](../apps/plugin-jira/). It is the **Work Tracker** provider category integration: Atlassian domain + email + API-token auth, with read-only chat tools to search Jira issues with JQL (`searchJiraIssues`), fetch full issue details (`getJiraIssue`), read issue comments (`getJiraIssueComments`), and list accessible projects (`listJiraProjects`).

### Web content fetching

The global `fetchWebContent` tool ([`packages/core/src/ai/web-fetch-tool.ts`](../packages/core/src/ai/web-fetch-tool.ts)) fetches any URL and extracts clean readable content using `@mozilla/readability` (the same engine Firefox Reader View uses) plus `linkedom` for server-side DOM parsing. It strips ads, navigation, footers, and other boilerplate, returning the article title, text content, excerpt, site name, and byline. This tool is always available in chat sessions (no credentials needed).

## How core commands use modules

- **`connect` / `disconnect`** — `getIntegration(name)` then lifecycle methods.
- **`status integration`** — `testConnection()`; modules return structured tool checks where applicable.
- **`summarize <integration>`** — `getIntegrationModule`, require `summarize` in `capabilities` and a defined `summarize` function, then AI generation on returned messages.
- **`organize <integration>`** — `getIntegrationModule`, require `organize` in `capabilities` and a defined `organize` function. Pass `--dry-run` to preview changes. Pass `--watch "<interval>"` to run immediately and then repeat periodically (e.g. `--watch "every hour"` or `--watch "30m"`); stop with Ctrl+C.
- **`chat [words...]`** — Optional first word may be a chat integration name (`gmail`, `todoist`, `slack`, `azuread`); remaining words are the prompt. If the first word is not an integration, the whole line is treated as the prompt and **all connected** chat integrations are used together (merged tools + combined system prompt). Repeat **`--integration <name>`** to choose an explicit set; when that flag is used, positional words are **only** the prompt. Use **`--prompt <text>`** (or bare **`toby -p "…"`**, which maps to `chat --prompt`) for an initial message when opening chat without typing in the TUI. At the root command, unknown positional tokens (for example a mistyped subcommand) are **not** treated as prompts. By default an **Ink** session keeps the full `CoreMessage[]` history; `askUser` is routed through the TUI. If there is no initial prompt, type the first message in the TUI. Pass **`--no-tui`** for a single console turn (one integration still uses `module.chat`; multiple integrations use one combined tool-calling turn, readline `askUser` only). In the TUI, **`/integration`** opens a multi-select picker (Space toggles, Enter applies).
- **Chat tool feedback (Ink TUI)** — After each tool runs, a compact result line is shown in the transcript. Per-tool copy is customizable via `registerToolFeedbackFormatter` in [`apps/cli/src/ui/chat/tool-feedback-registry.ts`](../apps/cli/src/ui/chat/tool-feedback-registry.ts) (call from a side-effect import or bootstrap code; avoid import cycles with `tools.ts`).
- **`configure`** — builds credential UI from `getCredentialDescriptors` across `getIntegrationModules()`, saves via each `mergeCredentialsPatch`.
  - When `authMethods` are provided, configure shows an auth-method selector and only method-relevant credential fields.

Keeping this wiring generic avoids adding new `if (name === "…")` branches in core commands when a new integration is added.

## Installable plugins

Third-party (or independently built) integrations can ship as executables named
`toby-plugin-<name>`. Toby discovers them under `~/.toby/plugins/` (or
`$TOBY_DIR/plugins/`), then adapts them into `IntegrationModule` instances using
the subprocess protocol in [`plugin-protocol.md`](plugin-protocol.md).

| Command | Purpose |
| ------- | ------- |
| `toby plugins list` | Show discovered plugin binaries and metadata |
| `toby plugins install <path>` | Validate and copy a plugin into `~/.toby/plugins/` |
| `toby plugins uninstall <name>` | Remove a managed plugin and purge its stored configuration |
| `toby plugins inspect <name>` | Show plugin details and tool catalog |
| `toby plugins doctor` | Validate protocol compatibility |

Runtime code lives under [`packages/core/src/integrations/plugins/`](../packages/core/src/integrations/plugins/).
Reference plugins: [`apps/plugin-sample/`](../apps/plugin-sample/) (minimal),
[`apps/plugin-azuread/`](../apps/plugin-azuread/) and
[`apps/plugin-gmail/`](../apps/plugin-gmail/) (full parity; shipped in release
archives as `toby-plugin-azuread`, `toby-plugin-gmail`, `toby-plugin-todoist`, `toby-plugin-jira`, `toby-plugin-websearch`,
`toby-plugin-applecalendar`, and `toby-plugin-macos`).

Built-in modules in `MODULES` take precedence when names collide. Toby remains
the source of truth for credentials (`credentials.json`) and connection state
(`config.json`); plugins receive config envelopes on stdin.
