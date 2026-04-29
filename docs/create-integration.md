# Creating a new integration

This checklist assumes a **first-party** integration living in-repo under `src/integrations/<id>/`, consistent with Gmail and Todoist.

## 1. Scaffold the folder

Create `src/integrations/<id>/` with at least:

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

1. Implement **lifecycle** (`connect`, `disconnect`, `isConnected`, `testConnection`) using [`readConfig` / `writeConfig`](../src/config/index.ts) and your client.
2. Set **`name`** (CLI identifier), **`displayName`**, **`description`**.
3. Set **`capabilities`** to the subset you support. If you add a **new** capability string, extend `IntegrationCapability` in [`src/integrations/types.ts`](../src/integrations/types.ts) and teach any core command that should use it (or add a new generic dispatcher there).
4. Implement **`getCredentialDescriptors`**, **`seedCredentialValues`**, and **`mergeCredentialsPatch`** so `configure` can show and persist secrets. Map into `CredentialsFile` in [`src/config/index.ts`](../src/config/index.ts) — you may need to extend `CredentialsFile` with a new optional block for your service.
   - If your integration supports multiple auth paths, set `authMethods` on the module and use `showForAuthMethods` on descriptors so the configure UI shows only fields relevant to the selected method.
5. If the integration supports inbox-style summaries, implement **`summarize`** returning `{ status: "ok", messages }` or `{ status: "empty", message }` per [`SummarizeRunResult`](../src/integrations/types.ts).
6. Optionally implement **`registerCommands(program)`** for integration-specific commands (see [`src/integrations/gmail/cli.ts`](../src/integrations/gmail/cli.ts)).

## 3. Register the module

In [`src/integrations/index.ts`](../src/integrations/index.ts):

- Import your module object.
- Append it to the **`MODULES`** array.

No other registry file exists; this array is the source of truth.

## 4. Wire config storage (if new credential shape)

If `CredentialsFile` gains new fields:

- Update [`src/config/index.ts`](../src/config/index.ts) types and any helpers.
- Update credential merge behavior in [`src/ui/configure/session.ts`](../src/ui/configure/session.ts) only if your shape needs custom handling beyond module `mergeCredentialsPatch`; most integrations should rely on the generic module patch merge.

## 5. Tests

Extend [`tests/integrations.test.ts`](../tests/integrations.test.ts) (or add a focused test file) to assert:

- The new `name` appears in `getIntegrationModules()`.
- Descriptor and capability expectations match what you documented.

Run:

```bash
bun run lint && bun run typecheck && bun run test
```

## 6. Documentation

Update [`docs/integrations.md`](integrations.md) if you introduce new capabilities, registry helpers, or conventions future modules should follow.
