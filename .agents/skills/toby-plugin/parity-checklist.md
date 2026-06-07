# Built-in → plugin parity checklist

Use when migrating an existing `IntegrationModule` with **no behavioral
regression**. Check each row before merge.

## Identity

| Built-in | Plugin `status` field |
| -------- | --------------------- |
| `name` | `name` |
| `displayName` | `displayName` |
| `description` | `description` |
| `capabilities` | `capabilities` (omit = `["chat"]`; `[]` = none) |
| `providerCategories` | `providerCategories` |
| `resources` | `resources` |

## Configure

| Built-in | Plugin |
| -------- | ------ |
| `authMethods` | `status.authMethods` |
| `getCredentialDescriptors` | `config shape` (+ `showForAuthMethods`) |
| `seedCredentialValues` | Stored in `credentials.integrations.<name>` (adapter seeds) |
| `mergeCredentialsPatch` | Adapter merges configure saves |
| Auth inference | `config get` normalized values |
| Legacy credential paths | `migrate.ts` one-time copy |

## Lifecycle

| Built-in | Plugin |
| -------- | ------ |
| `connect` (OAuth, validation) | `connect` + optional `config` writeback |
| `disconnect` (token purge) | `disconnect` + `config` patch clearing secrets |
| `isConnected` | `state.connectedAt` in envelope (adapter owns write) |
| `testConnection` basic | `status` with envelope |
| `testConnection({ validateTools })` | `status` with `validateTools: true` → `tools[]` |

## Chat

| Built-in | Plugin |
| -------- | ------ |
| `createChatTools` | `tools list` + `tools execute` |
| Tool input schemas | JSON Schema in `tools list` |
| OAuth refresh mid-chat | `tools execute` `config` writeback |
| `chatModelPrep` | `status.chatModelPrep` (adapter wraps persona) |
| `chatReadiness` | `status.chatReadiness` |
| `chat` headless command | Adapter `chat()` + `chatModelPrep` |

## Release UX

| Built-in | Plugin |
| -------- | ------ |
| Works without manual install | Release archive + `install-toby.sh` + upgrade staging |
| Dev workflow | `build:plugin:<name>` + `toby plugins install --link` |

## Verification commands

```bash
toby configure
toby connect <name>                    # each auth method
toby status integration -i <name>
toby status integration -i <name> --validate-tools
toby chat <name> "..." --no-tui
toby disconnect <name>
toby plugins doctor
```

Automated: contract tests in `apps/cli/tests/plugins*.test.ts` (e.g. `plugins-websearch.test.ts` for Swift API-key + global tool migration).

**Global tools:** when a built-in tool was exposed globally (e.g. `webSearch`), keep a thin bridge in `@toby/core` that delegates to the plugin — see [`packages/core/src/integrations/websearch/global-tools.ts`](../../../packages/core/src/integrations/websearch/global-tools.ts).
