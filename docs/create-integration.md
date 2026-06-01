# Creating a new integration

This checklist assumes a **first-party** integration living in-repo under `apps/cli/src/integrations/<id>/`, consistent with Gmail and Todoist.

## 1. Scaffold the folder

Create `apps/cli/src/integrations/<id>/` with at least:

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

1. Implement **lifecycle** (`connect`, `disconnect`, `isConnected`, `testConnection`) using [`readConfig` / `writeConfig`](../apps/cli/src/config/index.ts) and your client.
2. Set **`name`** (CLI identifier), **`displayName`**, **`description`**.
3. Set **`capabilities`** to the subset you support. If you add a **new** capability string, extend `IntegrationCapability` in [`apps/cli/src/integrations/types.ts`](../apps/cli/src/integrations/types.ts) and teach any core command that should use it (or add a new generic dispatcher there).
4. Implement **`getCredentialDescriptors`**, **`seedCredentialValues`**, and **`mergeCredentialsPatch`** so `configure` can show and persist secrets. Map into `CredentialsFile` in [`apps/cli/src/config/index.ts`](../apps/cli/src/config/index.ts) — you may need to extend `CredentialsFile` with a new optional block for your service.
   - If your integration supports multiple auth paths, set `authMethods` on the module and use `showForAuthMethods` on descriptors so the configure UI shows only fields relevant to the selected method.
5. If the integration supports inbox-style summaries, implement **`summarize`** returning `{ status: "ok", messages }` or `{ status: "empty", message }` per [`SummarizeRunResult`](../apps/cli/src/integrations/types.ts).
6. Optionally implement **`registerCommands(program)`** for integration-specific commands (see [`apps/cli/src/integrations/gmail/cli.ts`](../apps/cli/src/integrations/gmail/cli.ts)).

### Note on watch / scheduling

Integrations should implement **one-shot** runners (e.g. `module.organize(...)`) that complete a single pass of work.
Recurring execution (like `toby organize --watch "every hour"`) is orchestrated by the **core command layer**, not by integration modules.

## 3. Register the module

In [`apps/cli/src/integrations/index.ts`](../apps/cli/src/integrations/index.ts):

- Import your module object.
- Append it to the **`MODULES`** array.

No other registry file exists; this array is the source of truth.

## 4. Wire config storage (if new credential shape)

If `CredentialsFile` gains new fields:

- Update [`apps/cli/src/config/index.ts`](../apps/cli/src/config/index.ts) types and any helpers.
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

## Inbound chat (optional)

For chat-category integrations that should respond to @mentions or DMs while the daemon runs:

1. Add `apps/cli/src/integrations/<id>/inbound.ts` implementing `ChatInboundProvider` from [`apps/cli/src/chat-inbound/types.ts`](../apps/cli/src/chat-inbound/types.ts):
   - `start(ctx)` — long-lived connection; call `ctx.emit(normalizedEvent)` for each user message.
   - `deliverReply` / `deliverAskUser` — post back to the same channel/thread.
   - Optional `buildInboundPersonaAppendix`, `matchesAskUserReply`.
2. Set `chatInbound` on your `IntegrationModule` export.
3. Document your `external_key` format (stable per channel+thread).
4. Store transport credentials via existing configure descriptors; use `integrations.<id>.inboundEnabled` in config for the toggle.

Core routing, session mapping, and headless turns live in [`apps/cli/src/chat-inbound/`](../apps/cli/src/chat-inbound/) and [`apps/cli/src/chat-pipeline/headless-session.ts`](../apps/cli/src/chat-pipeline/headless-session.ts) (which runs the shared node pipeline). See [`docs/chat-inbound.md`](chat-inbound.md) and [`docs/chat-pipeline.md`](chat-pipeline.md).

**Slack** is the reference implementation: [`apps/cli/src/integrations/slack/inbound.ts`](../apps/cli/src/integrations/slack/inbound.ts).

## External installable plugin (optional)

To ship an integration **outside** the main Toby binary:

1. Implement a standalone CLI named `toby-plugin-<name>` following [`docs/plugin-protocol.md`](plugin-protocol.md).
2. Install the binary with `toby plugins install <path>` or copy it into `~/.toby/plugins/`.
3. Run `toby plugins doctor` to validate protocol compatibility.

See [`apps/plugin-sample/`](../apps/plugin-sample/) for a minimal reference plugin and build script (`bun run build:plugin:sample`).

No changes to `MODULES` are required — discovery registers plugin-backed modules automatically.
