# Creating a new integration

**All new integrations are TypeScript bun-package plugins** (directory named
`toby-plugin-<name>/` with `manifest.json` + TypeScript entrypoint). Do not add
in-process modules under `packages/core/src/integrations/<name>/` and do not
create compiled binary or Swift plugins. When macOS frameworks or TCC are
required, delegate to **Toby.app’s native API server** from the TypeScript
plugin (see [`apps/plugin-macos/`](../apps/plugin-macos/) and
[`apps/plugin-applecalendar/`](../apps/plugin-applecalendar/)).

Interactive configuration is served by core configure APIs and rendered in
Toby.app. The harness adapts plugins into `IntegrationModule` at discovery time.
See [`architecture.md`](architecture.md#core-vs-apps),
[`plugin-protocol.md`](plugin-protocol.md), and the repo skill
[`.agents/skills/toby-plugin/SKILL.md`](../.agents/skills/toby-plugin/SKILL.md).

## 1. Scaffold a bun-package plugin

Create `apps/plugin-<name>/` (release name `toby-plugin-<name>/`):

```text
apps/plugin-myintegration/
  manifest.json
  package.json
  README.md
  src/
    index.ts          # protocol entry (status, connect, tools, …)
    tools.ts          # tool definitions + execute
    prompts.ts        # optional chatModelPrep strings
    auth.ts           # optional OAuth / token helpers
```

`manifest.json` must declare `name`, `displayName`, `description`, `version`,
`protocolVersion: "1"`, and `runtime: { "type": "bun", "entry": "src/index.ts" }`.
Optional: `capabilities`, `providerCategories`, `icon` / `iconAsset`.

Use local credential field keys in `config shape` (Toby namespaces them as
`<name>.<key>`).

## 2. Implement the plugin protocol

Implement the v1 subcommand matrix in [`plugin-protocol.md`](plugin-protocol.md):

| Subcommand | Role |
| ---------- | ---- |
| `status` | Identity, health, `capabilities`, optional `chatModelPrep`, `authMethods`, `chatReadiness` |
| `connect` / `disconnect` | Lifecycle; optional config writeback |
| `config shape` / `get` / `set` | Configure UI fields and normalization |
| `tools list` / `tools execute` | Chat tool catalog and execution (`dryRun`, `appliedActions`) |
| `setup` / `setup guide` | Optional one-time setup and onboarding wizard content |
| `inbound run` | Optional long-lived NDJSON inbound transport |

Rules:

1. **stdout** — exactly one JSON object (or NDJSON lines for inbound).
2. **stdin** — config envelope for credential/state; do **not** read `~/.toby/`.
3. Exit codes: `0` success, `1` business failure, `2` contract/usage error.
4. Honor `dryRun` for mutating tools; return `appliedActions` for side effects.

Provider categories (when relevant): `email`, `calendar`, `tasks`, `contacts`,
`chat`, `documents`, `work_tracker`.

Capabilities today: `"chat"` (tools in chat) and/or `"inbound"` (daemon listener).

## 3. Register for local development

No changes to `BUILTIN_MODULES` are required — discovery loads plugins
automatically.

```bash
bun run --cwd apps/plugin-myintegration build   # if the package defines build
# or run sources via Bun entry as in other plugins
toby plugins install ./apps/plugin-myintegration --link --force
toby plugins doctor
toby connect myintegration
```

First-party plugins are also built into `dist/` via root scripts
(`bun run build:plugins` / per-plugin `build:plugin:*`).

## 4. Chat model prep (when `capabilities` includes `"chat"`)

Return `chatModelPrep` on `status` with integration rules and templates
(`{{userPrompt}}` placeholders). Toby wraps these with persona composition and
global tool guidance. See
[complex integration extensions](plugin-protocol.md#complex-integrations-oauth-auth-methods-chat-prep).

## 5. Inbound chat (optional)

For chat platforms that should answer @mentions/DMs while the daemon runs:

1. Advertise `"inbound"` (and usually `"chat"`) in capabilities.
2. Implement `inbound run` (NDJSON) per
   [plugin-protocol inbound](plugin-protocol.md#inbound-chat-daemon-transport).
3. Document your `external_key` format (stable per channel + thread).
4. Store bot/app tokens via `config shape`; use
   `integrations.<name>.inboundEnabled` plus global `chatInbound` in config.

Core routing stays in [`packages/core/src/chat-inbound/`](../packages/core/src/chat-inbound/);
the plugin transport is adapted by
[`inbound-adapter.ts`](../packages/core/src/integrations/plugins/inbound-adapter.ts).
Reference: [`apps/plugin-slack/`](../apps/plugin-slack/).

See [`chat-inbound.md`](chat-inbound.md) and [`daemon.md`](daemon.md).

## 6. macOS-native work (optional)

If tools need EventKit, Contacts, Accessibility, or similar:

1. Add endpoints/handlers in Toby.app (`apps/toby-app/Sources/TobyApp/Native/`).
2. Call them over HTTP from the TypeScript plugin (pattern in
   `apps/plugin-macos` / `apps/plugin-applecalendar`).
3. Do not ship a second native binary for the integration.

## 7. Tests and verification

- Unit-test pure tool/inbound logic in the plugin package when practical
  (e.g. Slack’s `apps/plugin-slack/tests/`).
- Run harness checks after install:

```bash
bun run lint && bun run typecheck && bun run test
toby plugins doctor
toby status integration myintegration
```

## 8. Documentation

- Add a short section or dedicated doc under `docs/` if the integration has
  non-obvious setup (tokens, TCC, scopes).
- Update [`integrations.md`](integrations.md) first-party table when shipping
  a new first-party plugin.
- Prefer implementing **`setup guide`** so Toby.app can show a step-by-step
  wizard (redirect URIs, scopes, links).

## Reference implementations

| Plugin | Why look here |
| ------ | ------------- |
| [`apps/plugin-sample-ts/`](../apps/plugin-sample-ts/) | Minimal protocol surface |
| [`apps/plugin-email/`](../apps/plugin-email/) | Auth methods, config writeback, chat tools |
| [`apps/plugin-slack/`](../apps/plugin-slack/) | Chat + inbound sidecar |
| [`apps/plugin-jira/`](../apps/plugin-jira/) | Work tracker category |
| [`apps/plugin-notion/`](../apps/plugin-notion/) | Documents category |
| [`apps/plugin-macos/`](../apps/plugin-macos/) | Native API delegation + `setup` |
| [`apps/plugin-news/`](../apps/plugin-news/) | Multi-source news (Hacker News + The Guardian) |

## Historical note: built-in modules

Older docs and some type comments refer to first-party modules under
`packages/core/src/integrations/<name>/` and a `MODULES` / `BUILTIN_MODULES`
registration list. That path is **legacy**: `BUILTIN_MODULES` is empty and all
shipped integrations are plugins. Do not revive in-process integrations unless
there is a strong product reason; prefer the plugin protocol so installs stay
independent of the core binary.
