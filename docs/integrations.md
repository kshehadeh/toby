# Integrations

Integrations are **installable TypeScript plugins** discovered at runtime and
adapted into `IntegrationModule` instances. The harness registry in
[`packages/core/src/integrations/index.ts`](../packages/core/src/integrations/index.ts)
merges an (empty) built-in list with plugins from
[`packages/core/src/integrations/plugins/`](../packages/core/src/integrations/plugins/).
The CLI and Toby.app both resolve integrations through that registry.

**All first-party and new integrations are bun-package plugins** under
`apps/plugin-<name>/` (installed as `toby-plugin-<name>/`). There are no in-tree
built-in integration modules under `packages/core/src/integrations/<name>/`
today — `BUILTIN_MODULES` is empty. See [`plugin-protocol.md`](plugin-protocol.md)
and [`create-integration.md`](create-integration.md).

## Types (`packages/core/src/integrations/types.ts`)

### `Integration`

Baseline contract every integration satisfies:

- Identity: `name`, `displayName`, `description` (optional `icon`, `iconUrl`, `launchUrl`)
- Lifecycle: `connect`, `disconnect`, `isConnected`, `testConnection`

`testConnection` returns `IntegrationHealth`, optionally including per-tool rows
(`IntegrationToolHealth`) for `status integration` / validate-tools flows.

### `IntegrationModule`

Extends `Integration` with capabilities and hooks. Plugin adapters synthesize
these from the plugin protocol (`status`, `config shape`, `tools list`, etc.).

| Field / method | Purpose |
| ---------------- | ------- |
| `capabilities` | Subset of `IntegrationCapability`: `"chat"` and/or `"inbound"`. |
| `providerCategories?` | Provider buckets for default-provider selection and schedule routing: `"email"` \| `"calendar"` \| `"tasks"` \| `"contacts"` \| `"chat"` \| `"documents"` \| `"work_tracker"`. |
| `authMethods?` | Optional auth options for configure UI (e.g. OAuth vs API key) with a default method. |
| `configureHint?` | Shown when the integration has no editable credential fields. |
| `resources?` | Optional strings describing entities (inbox, tasks, …) for discovery UI. |
| `chatModelPrep?` | System/user message builders for single- and multi-integration chat. |
| `chatReadiness?(creds)` | Whether the integration can participate in chat selection. |
| `getCredentialDescriptors()` | Fields under Integrations in configure (`CredentialFieldDescriptor`). |
| `seedCredentialValues(creds)` | Flat value map when opening configure. |
| `mergeCredentialsPatch(values, previous)` | `Partial<CredentialsFile>` fragment on save. |
| `createChatTools?(params)` | Tools + action accumulator for **RunModelTurnNode** (plugin tools go through the adapter). |
| `dashboard?` | Optional `getSummary` for standard-tool data (often synthesized from `standardTool` tags). Used inside dashboard **flows** / aggregator; home cards load a single content path. See [dashboard.md](dashboard.md) and [flows.md](flows.md). |
| `chatInbound?` | Long-lived inbound listener for the daemon (`ChatInboundProvider`). For plugins, created by [`inbound-adapter.ts`](../packages/core/src/integrations/plugins/inbound-adapter.ts). See [`chat-inbound.md`](chat-inbound.md). |
| `registerCommands?(program)` | Optional Commander subcommands on the CLI. |

Types are exported from [`types.ts`](../packages/core/src/integrations/types.ts).
The barrel [`index.ts`](../packages/core/src/integrations/index.ts) exposes
runtime registry helpers.

## Registry

[`packages/core/src/integrations/index.ts`](../packages/core/src/integrations/index.ts):

- `BUILTIN_MODULES` — reserved for in-process modules; currently **empty**.
- Plugin modules — loaded via `getPluginModules()` from discovery under
  `~/.toby/plugins/`, release `dist/`, or next to the `toby` binary.

If a built-in and a plugin ever share a name, the built-in wins. Plugins alone
are the normal case.

| Function | Use |
| -------- | --- |
| `getIntegrationModules()` | All modules (full `IntegrationModule`). |
| `getIntegrationModule(name)` | Lookup by CLI name (`email`, `todoist`, `slack`). |
| `getModulesWithCapability(cap)` | Filter by `"chat"` or `"inbound"`. |
| `getModulesForCategory(category)` | Filter by provider category. |
| `getIntegrations()` / `getIntegration(name)` | Lifecycle-only view of the same instances. |
| `getIntegrationIconUrl(name)` | Relative icon URL when present. |
| `isBuiltinIntegration(name)` | True only for names in `BUILTIN_MODULES`. |

Plugin discovery, install, and adaptation live under
[`packages/core/src/integrations/plugins/`](../packages/core/src/integrations/plugins/).

## First-party plugins

| Integration | Package | Notes |
| ----------- | ------- | ----- |
| **Email** | [`apps/plugin-email/`](../apps/plugin-email/) | IMAP/SMTP; OAuth/auth methods; chat tools for mailbox workflows. |
| **Todoist** | [`apps/plugin-todoist/`](../apps/plugin-todoist/) | Task list provider; API key auth. |
| **Slack** | [`apps/plugin-slack/`](../apps/plugin-slack/) | Chat tools + **daemon inbound** (Socket Mode). Bot token (`xoxb-…`) and app token (`xapp-…`) required for inbound; OAuth user token is for user-scoped tools. See [help-site Slack credentials](../apps/help-site/docs/integrations/slack.md#credentials-and-auth-reference). |
| **Jira** | [`apps/plugin-jira/`](../apps/plugin-jira/) | Work tracker: JQL search, issue/comment/project tools. |
| **Notion** | [`apps/plugin-notion/`](../apps/plugin-notion/) | Documents provider: search/read pages; write/append content. |
| **macOS** | [`apps/plugin-macos/`](../apps/plugin-macos/) | macOS-only system control; delegates to Toby.app native API. See [`macos-integration.md`](macos-integration.md). |
| **Apple Calendar** | [`apps/plugin-applecalendar/`](../apps/plugin-applecalendar/) | macOS-only; EventKit via Toby.app. See [`apple-calendar.md`](apple-calendar.md). |
| **Apple Contacts** | [`apps/plugin-applecontacts/`](../apps/plugin-applecontacts/) | macOS-only contact list; Contacts.framework via Toby.app. See [`apple-contacts.md`](apple-contacts.md). |
| **Apple Reminders** | [`apps/plugin-applereminders/`](../apps/plugin-applereminders/) | macOS-only task list; EventKit via Toby.app. See [`apple-reminders.md`](apple-reminders.md). |
| **News** | [`apps/plugin-news/`](../apps/plugin-news/) | Headlines and search via Hacker News (no key) and The Guardian (optional free API key). See [`news.md`](news.md). |
| **Sample** | [`apps/plugin-sample-ts/`](../apps/plugin-sample-ts/) | Minimal protocol reference. |

Release archives ship these as `toby-plugin-<name>` directories under
`~/.toby/plugins/` (or next to the binary during local `dist/` development).

### Built-in global tools (not plugins)

**Web Search** ([`web-search.md`](web-search.md)) uses the Vercel AI Gateway’s
Perplexity search. The `webSearch` tool is a **conditional global tool**: when
enabled in Settings → Web Search and a Vercel AI Gateway API key is present, it
is available in every chat session regardless of the persona’s AI provider.

**Weather** ([`weather.md`](weather.md)) uses Open-Meteo for global forecasts.
The `getWeather` tool is a **conditional global tool**: when enabled in
Settings → Weather, it is available in every chat session. No API key is
required for the free tier; an optional customer key is supported. Place names
are geocoded (Nominatim by default).

**`fetchWebContent`** ([`packages/core/src/ai/web-fetch-tool.ts`](../packages/core/src/ai/web-fetch-tool.ts))
fetches a URL and extracts readable content via `@mozilla/readability` +
`linkedom`. PDF URLs are extracted with the same helper as `readPdf`. No
credentials required.

**`readPdf`** ([`pdf-read.md`](pdf-read.md)) extracts searchable text from a
PDF (current-turn attachment, project-relative path, or `http`/`https` URL)
and returns it as the tool result. Always registered. No credentials
required. Scanned image PDFs are not OCR’d.

**Location** ([`location.md`](location.md)) reads the user’s current position
from macOS Location Services through Toby.app. The `getMyLocation` tool is a
**global tool** (always registered; macOS only) and prompts for Location
permission when needed.

## How the product uses modules

- **`connect` / `disconnect`** — `getIntegration(name)` then lifecycle methods.
- **`status integration`** — `testConnection()`; optional per-tool probes.
- **Native chat (Toby.app) and daemon inbound** — select chat-capable modules,
  merge tools, run the shared chat pipeline
  ([`chat-pipeline.md`](chat-pipeline.md)).
- **Schedules** — headless turns with the same tool-calling pipeline.
- **Configure API** — credential fields from `getCredentialDescriptors` across
  `getIntegrationModules()`; save via `mergeCredentialsPatch`; consumed by
  Toby.app.
  - Toby.app presents available integrations as an overview of cards, with
    individual setup and credential details loaded when one is selected.
  - When `authMethods` are set, configure shows an auth-method selector.
    Credential fields carry `showForAuthMethods` / `showForInbound` metadata;
    Toby.app filters the visible set live as the auth method (or inbound
    toggle) changes, so the form does not wait for a tree rebuild.
  - Toby.app can open an **Integration Setup Wizard** (guided onboarding).

Keeping command and API wiring generic avoids `if (name === "…")` branches when
a new plugin is installed.

## Integration setup guide

Guided onboarding for Toby.app is also available at:

```text
GET /api/integrations/<name>/setup-guide
```

The response includes `displayName`, `description`, and `steps` (title,
description, optional `links` / `artifacts`). Plugins implement
`setup guide`; otherwise Toby builds a generic guide from `status`,
`config shape`, and `authMethods`.

Credentials stay in `~/.toby/credentials.json` and connection state in
`~/.toby/config.json`. After fields are filled, the wizard runs connect/status
through existing actions. See [`plugin-protocol.md`](plugin-protocol.md#setup-guide).

## Installable plugins (operations)

| Command | Purpose |
| ------- | ------- |
| `toby plugins list` | Discovered plugins and metadata |
| `toby plugins install <path>` | Validate and install into `~/.toby/plugins/` |
| `toby plugins uninstall <name>` | Remove managed plugin and purge its config |
| `toby plugins inspect <name>` | Details and tool catalog |
| `toby plugins doctor` | Protocol compatibility checks |
| `toby plugins setup <name>` | One-time setup (e.g. macOS Shortcuts) when advertised |

Toby remains the source of truth for credentials and connection state; plugins
receive config envelopes on stdin and must not read/write `~/.toby/` directly.
