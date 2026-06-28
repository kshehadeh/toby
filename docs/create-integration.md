# Creating a new integration

This checklist assumes a **first-party** integration in **`@toby/core`** under `packages/core/src/integrations/<id>/`, consistent with Slack. Gmail, Todoist, Azure AD, Jira, Web Search, Apple Calendar, and macOS ship as installable plugins instead (see [Migrating a built-in to a plugin](#migrating-a-built-in-to-a-plugin)). Ink/configure UX stays in `apps/cli`; harness code stays in core. See [`architecture.md`](architecture.md#core-vs-apps).

## 1. Scaffold the folder

Create `packages/core/src/integrations/<id>/` with at least:

- `client.ts` — API client and any types for requests/responses.
- `index.ts` — single exported `IntegrationModule` instance (e.g. `myServiceIntegrationModule`).

Add optional files as needed:

- `auth.ts` — OAuth or token exchange used by `connect`.
- `tools.ts` — AI tools (`tool()` from `ai` package).
- `prompts/*.ts` — message builders for summarize/organize flows.
- `cli.ts` — `registerCommands(program)` implementation if the integration exposes its own subcommands.

Use **flat credential keys** in descriptors (e.g. `myservice.apiKey`) so they merge cleanly with the configure UI’s value map.

## 2. Implement `IntegrationModule`

In `index.ts`:

1. Implement **lifecycle** (`connect`, `disconnect`, `isConnected`, `testConnection`) using [`readConfig` / `writeConfig`](../packages/core/src/config/index.ts) and your client.
2. Set **`name`** (CLI identifier), **`displayName`**, **`description`**.
3. Set **`capabilities`** to the subset you support. If you add a **new** capability string, extend `IntegrationCapability` in [`packages/core/src/integrations/types.ts`](../packages/core/src/integrations/types.ts) and teach any core command that should use it (or add a new generic dispatcher there).
4. Implement **`getCredentialDescriptors`**, **`seedCredentialValues`**, and **`mergeCredentialsPatch`** so `configure` can show and persist secrets. Map into `CredentialsFile` in [`packages/core/src/config/index.ts`](../packages/core/src/config/index.ts) — you may need to extend `CredentialsFile` with a new optional block for your service.
   - If your integration supports multiple auth paths, set `authMethods` on the module and use `showForAuthMethods` on descriptors so the configure UI shows only fields relevant to the selected method.
5. If the integration supports inbox-style summaries, implement **`summarize`** returning `{ status: "ok", messages }` or `{ status: "empty", message }` per [`SummarizeRunResult`](../packages/core/src/integrations/types.ts).
6. Optionally implement **`registerCommands(program)`** for integration-specific subcommands (see the Slack module for an example).

### Note on watch / scheduling

Integrations should implement **one-shot** runners (e.g. `module.organize(...)`) that complete a single pass of work.
Recurring execution (like `toby organize --watch "every hour"`) is orchestrated by the **core command layer**, not by integration modules.

## 3. Register the module

In [`packages/core/src/integrations/index.ts`](../packages/core/src/integrations/index.ts):

- Import your module object.
- Append it to the **`MODULES`** array.

No other registry file exists; this array is the source of truth.

## 4. Wire config storage (if new credential shape)

If `CredentialsFile` gains new fields:

- Update [`packages/core/src/config/index.ts`](../packages/core/src/config/index.ts) types and any helpers.
- Update credential merge behavior in [`apps/cli/src/ui/configure/session.ts`](../apps/cli/src/ui/configure/session.ts) only if your shape needs custom handling beyond module `mergeCredentialsPatch`; most integrations should rely on the generic module patch merge.

## 5. Tests

Extend [`apps/cli/tests/integrations.test.ts`](../apps/cli/tests/integrations.test.ts) (or add a focused test file) to assert:

- The new `name` appears in `getIntegrationModules()`.
- Descriptor and capability expectations match what you documented.

Run:

```bash
bun run lint && bun run typecheck && bun run test
```

## 6. Documentation

Update [`docs/integrations.md`](integrations.md) if you introduce new capabilities, registry helpers, or conventions future modules should follow.

If you are shipping as an installable plugin, consider implementing the optional [`setup guide`](plugin-protocol.md#setup-guide) subcommand so **Toby.app** can show a guided onboarding wizard for your integration (provider links, copyable redirect URIs/scopes, inline credential fields, and connect/validate actions).

## Inbound chat (optional)

For chat-category integrations that should respond to @mentions or DMs while the daemon runs:

1. Add `packages/core/src/integrations/<id>/inbound.ts` implementing `ChatInboundProvider` from [`packages/core/src/chat-inbound/types.ts`](../packages/core/src/chat-inbound/types.ts):
   - `start(ctx)` — long-lived connection; call `ctx.emit(normalizedEvent)` for each user message.
   - `deliverReply` / `deliverAskUser` — post back to the same channel/thread.
   - Optional `buildInboundPersonaAppendix`, `matchesAskUserReply`.
2. Set `chatInbound` on your `IntegrationModule` export.
3. Document your `external_key` format (stable per channel+thread).
4. Store transport credentials via existing configure descriptors; use `integrations.<id>.inboundEnabled` in config for the toggle.

Core routing, session mapping, and headless turns live in [`packages/core/src/chat-inbound/`](../packages/core/src/chat-inbound/) and [`packages/core/src/chat-pipeline/headless-session.ts`](../packages/core/src/chat-pipeline/headless-session.ts) (which runs the shared node pipeline). See [`docs/chat-inbound.md`](chat-inbound.md) and [`docs/chat-pipeline.md`](chat-pipeline.md).

**Slack** is the reference implementation: [`packages/core/src/integrations/slack/inbound.ts`](../packages/core/src/integrations/slack/inbound.ts).

## External installable plugin (optional)

To ship an integration **outside** the main Toby binary:

1. Implement a standalone CLI named `toby-plugin-<name>` following [`docs/plugin-protocol.md`](plugin-protocol.md).
2. Install the binary with `toby plugins install <path>` or copy it into `~/.toby/plugins/`.
3. Run `toby plugins doctor` to validate protocol compatibility.

See [`apps/plugin-sample-ts/`](../apps/plugin-sample-ts/) for a minimal reference plugin and build script (`bun run build:plugin:sample-ts`).

No changes to `MODULES` are required — discovery registers plugin-backed modules automatically.

## Migrating a built-in to a plugin

Use this checklist when moving an existing first-party integration out of
`packages/core/src/integrations/<name>/` (Azure AD and Gmail are reference migrations):

1. **Audit** the built-in `IntegrationModule` — lifecycle, credentials, tools,
   `chatModelPrep`, `chatReadiness`, and `testConnection({ validateTools })`.
2. **Extend the plugin protocol** only if a gap appears; prefer reusing the
   [complex integration extensions](plugin-protocol.md#complex-integrations-oauth-auth-methods-chat-prep)
   (`config` writeback, `authMethods`, `validateTools`, `chatModelPrep`,
   `chatReadiness`).
3. **Port** `client.ts`, `auth.ts`, `tools.ts`, and prompt strings into
   `apps/plugin-<name>/` (stdin config envelope; no `~/.toby/` access).
4. **Map** each `IntegrationModule` hook to protocol subcommands/responses.
5. **Remove** the module from `BUILTIN_MODULES` and delete integration-specific
   config helpers from `@toby/core`.
6. **Migrate** legacy credential shapes (e.g. top-level `credentials.azuread`
   → `credentials.integrations.azuread`).
7. **Bundle** the binary in release archives and auto-install to `~/.toby/plugins/`
   (`install-toby.sh`, upgrade staging, `build:plugins`).
8. **Verify** configure, connect (all auth methods), status `--validate-tools`,
   chat, and disconnect against the pre-migration baseline.

Reference implementations:

- Minimal plugin: [`apps/plugin-sample-ts/`](../apps/plugin-sample-ts/)
- Full parity migrations: [`apps/plugin-azuread/`](../apps/plugin-azuread/), [`apps/plugin-gmail/`](../apps/plugin-gmail/)
- TypeScript bun-package plugin migrations: [`apps/plugin-jira/`](../apps/plugin-jira/), [`apps/plugin-gmail/`](../apps/plugin-gmail/), [`apps/plugin-azuread/`](../apps/plugin-azuread/), [`apps/plugin-slack/`](../apps/plugin-slack/)
