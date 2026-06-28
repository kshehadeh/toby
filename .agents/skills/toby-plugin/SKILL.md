---
name: toby-plugin
description: >-
  Create a new Toby installable integration plugin or migrate a built-in
  integration from packages/core to toby-plugin-<name>. Use when the user asks
  to build a plugin, convert an integration to a plugin, implement plugin
  protocol v1, port azuread/gmail/slack-style modules externally, or wire
  release/install for toby-plugin binaries.
---

# Toby integration plugin

## Goal

Ship an integration as `toby-plugin-<name>` under `~/.toby/plugins/`, adapted
into `IntegrationModule` by `@toby/core`. Two paths:

| Path | When | Reference |
| ---- | ---- | --------- |
| **New plugin** | Greenfield integration, no built-in module | [`apps/plugin-sample-ts/`](../../../apps/plugin-sample-ts/) |
| **Migration** | Replace built-in in `BUILTIN_MODULES` with plugin | [`apps/plugin-azuread/`](../../../apps/plugin-azuread/), [`apps/plugin-gmail/`](../../../apps/plugin-gmail/), [`apps/plugin-jira/`](../../../apps/plugin-jira/) (TypeScript bun-package), [`apps/plugin-todoist/`](../../../apps/plugin-todoist/) (TypeScript bun-package), [`apps/plugin-slack/`](../../../apps/plugin-slack/) (TypeScript bun-package; inbound), [`apps/plugin-applecalendar/`](../../../apps/plugin-applecalendar/) (TypeScript bun-package; delegates EventKit to Toby.app), [`apps/plugin-macos/`](../../../apps/plugin-macos/) (TypeScript bun-package; delegates macOS ops to Toby.app) |

Read first: [`docs/plugin-protocol.md`](../../../docs/plugin-protocol.md),
[`docs/create-integration.md`](../../../docs/create-integration.md) (migration section).

## Hard rules

1. Binary name: `toby-plugin-<name>` where `<name>` matches `/^[a-z0-9_-]+$/`.
2. **Never** read or write `~/.toby/` from the plugin — config arrives on stdin;
   Toby merges optional `config` writeback from responses.
3. **stdout** = one JSON object only; stderr for human diagnostics.
4. Exit codes: `0` success, `1` business failure, `2` contract error.
5. Plugins cannot collide with names still in `BUILTIN_MODULES` — remove built-in
   before installing a plugin with the same name.
6. Chat-capable plugins **must** return `status.chatModelPrep` when
   `capabilities` includes `"chat"`.

## Decide complexity

**Minimal** (API key, static config): sample plugin pattern only — `status`,
`connect`, `disconnect`, `config shape|get|set`, `tools list|execute`.

**Complex** (OAuth, auth-method UI, deep health, rich chat): also use v1
extensions documented under *Complex integrations* in
[`docs/plugin-protocol.md`](../../../docs/plugin-protocol.md):

- `config` writeback on `connect`, `disconnect`, `tools execute`
- `authMethods` on `status`; `showForAuthMethods` on `config shape` fields
- `validateTools` on status stdin → `tools[]` health rows
- `chatModelPrep` on `status` (adapter adds persona + global tools section)
- `chatReadiness` on `status` when envelope present
- `config get` normalization (e.g. inferred `authMethod`)

Extend protocol in `packages/core/src/integrations/plugins/` only when no
existing extension fits. Prefer additive v1 changes.

---

## Workflow A — New plugin

```
Task progress:
- [ ] 1. Scaffold apps/plugin-<name>/
- [ ] 2. Implement protocol subcommands
- [ ] 3. Wire build + optional release bundle
- [ ] 4. Tests + doctor
```

### 1. Scaffold

Mirror [`apps/plugin-sample-ts/package.json`](../../../apps/plugin-sample-ts/package.json):

```
apps/plugin-<name>/
  package.json          # build → ../../dist/toby-plugin-<name>
  README.md
  src/
    cli.ts              # argv router
    protocol.ts         # stdin JSON, emitJson, parseEnvelope
    ...                 # client, tools, auth, prompts as needed
```

Root [`package.json`](../../../package.json): add `build:plugin:<name>` and
include in `build:plugins` if shipping in release.

### 2. Subcommands (all required unless noted)

| Subcommand | stdin | Notes |
| ---------- | ----- | ----- |
| `status` | optional envelope | Identity, `protocolVersion: "1"`, capabilities |
| `connect` | envelope | Validate; return `config` patch if tokens change |
| `disconnect` | optional envelope | Clear sensitive fields via `config` patch |
| `config shape` | — | Field defs; Toby namespaces as `<name>.<key>` |
| `config get` | envelope | Normalized config |
| `config set` | envelope | Optional sync hook |
| `tools list` | — | JSON Schema per tool |
| `tools execute` | tool request JSON | Honor `dryRun`; `appliedActions` for mutations |
| `setup` | optional envelope | **Optional** one-time setup; set `status.setupAvailable` |

### 3. Build & install

```bash
bun run build:plugin:<name>
toby plugins install ./dist/toby-plugin-<name>   # or --link --force for dev
toby plugins doctor
toby plugins setup <name>   # when setupAvailable
toby plugins inspect <name>
```

### 4. Tests

Add contract tests under `apps/cli/tests/` (see
[`plugins.test.ts`](../../../apps/cli/tests/plugins.test.ts),
[`plugins-azuread.test.ts`](../../../apps/cli/tests/plugins-azuread.test.ts),
[`plugins-gmail.test.ts`](../../../apps/cli/tests/plugins-gmail.test.ts)):
status, connect failure/success, tools list/execute, config shape, registry
discovery.

Run: `bun run typecheck`, `bun run test`.

---

## Workflow B — Migrate built-in → plugin

Use [parity-checklist.md](parity-checklist.md) for full replacement. Summary:

```
Task progress:
- [ ] 1. Audit built-in IntegrationModule
- [ ] 2. Protocol gaps → extend adapter if needed
- [ ] 3. Port code to apps/plugin-<name>/
- [ ] 4. Remove built-in + config helpers + legacy migration
- [ ] 5. Release wiring (if first-party ship)
- [ ] 6. Parity verification
```

### 1. Audit

Read `packages/core/src/integrations/<name>/` and list every
`IntegrationModule` surface:

- Lifecycle: `connect`, `disconnect`, `isConnected`, `testConnection`
- Credentials: `getCredentialDescriptors`, `seedCredentialValues`,
  `mergeCredentialsPatch`, `authMethods`
- Chat: `createChatTools`, `chat`, `chatModelPrep`, `chatReadiness`
- Optional: `summarize`, `organize`, `registerCommands`, `chatInbound`

Map each to a protocol subcommand/response field.

### 2. Port

- Move `client.ts`, `auth.ts`, `tools.ts`, prompts into plugin `src/`.
- Replace `readCredentials` / `writeCredentials` with envelope `config` +
  `config` writeback in responses.
- OAuth browser flows run inside plugin `connect`; tokens return in `config`.
- Token refresh during tools → `tools execute` `config` patch.

### 3. Remove built-in

- Delete `packages/core/src/integrations/<name>/`
- Remove from `BUILTIN_MODULES` in
  [`packages/core/src/integrations/index.ts`](../../../packages/core/src/integrations/index.ts)
- Remove integration-specific helpers from
  [`packages/core/src/config/index.ts`](../../../packages/core/src/config/index.ts)
- Add legacy credential migration in
  [`packages/core/src/integrations/plugins/migrate.ts`](../../../packages/core/src/integrations/plugins/migrate.ts)
  if top-level `credentials.<name>` existed

### 4. Release wiring (first-party plugins)

Update in lockstep:

- [`scripts/build-release-artifacts.sh`](../../../scripts/build-release-artifacts.sh)
- [`scripts/verify-release-artifacts.mjs`](../../../scripts/verify-release-artifacts.mjs)
- [`install-toby.sh`](../../../install-toby.sh) → `~/.toby/plugins/`
- [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) codesign
- [`apps/cli/src/upgrade/index.ts`](../../../apps/cli/src/upgrade/index.ts) staged install

### 5. Verify

| Command | Expect |
| ------- | ------ |
| `toby configure` | Auth selector, conditional fields, round-trip |
| `toby connect <name>` | Each auth path; token writeback |
| `toby status integration -i <name>` | Health details |
| `toby status integration -i <name> --validate-tools` | Per-tool rows |
| `toby chat <name> "..."` | Tools + prompts |
| `toby disconnect <name>` | Tokens cleared, state removed |
| `toby plugins doctor` | Pass |

Update [`docs/integrations.md`](../../../docs/integrations.md), help-site page,
and [`docs/create-integration.md`](../../../docs/create-integration.md) if the
migration template changes.

---

## Core touchpoints (migrations / protocol work)

| Area | Path |
| ---- | ---- |
| Protocol types | `packages/core/src/integrations/plugins/protocol.ts` |
| Adapter | `packages/core/src/integrations/plugins/adapter.ts` |
| Subprocess client | `packages/core/src/integrations/plugins/client.ts` |
| Discovery / registry | `packages/core/src/integrations/plugins/registry.ts` |
| Install / doctor | `packages/core/src/integrations/plugins/install.ts` |
| CLI commands | `apps/cli/src/commands/plugins.ts` |

---

## Common mistakes

- Forgetting `chatModelPrep` on chat plugins → `loadPluginMetadata` fails.
- Reading `~/.toby/credentials.json` inside plugin → breaks protocol contract.
- Leaving built-in in `BUILTIN_MODULES` → `builtin_collision` on install.
- OAuth without `config` writeback → tokens lost after connect/refresh.
- `capabilities: []` vs omitted: empty array disables chat; omitted defaults to
  `["chat"]` and requires `chatModelPrep`.

## Additional resources

- Full parity table: [parity-checklist.md](parity-checklist.md)
- Minimal example: [`apps/plugin-sample-ts/`](../../../apps/plugin-sample-ts/)
- Full migration examples: [`apps/plugin-azuread/`](../../../apps/plugin-azuread/), [`apps/plugin-gmail/`](../../../apps/plugin-gmail/), [`apps/plugin-jira/`](../../../apps/plugin-jira/) (TypeScript bun-package), [`apps/plugin-todoist/`](../../../apps/plugin-todoist/) (TypeScript bun-package)
- TypeScript bun-package plugin guide: [`.agents/skills/toby-ts-plugin/SKILL.md`](../toby-ts-plugin/SKILL.md) — manifest, directory-based build, release wiring for bun-package plugins
