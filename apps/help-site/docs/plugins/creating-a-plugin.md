---
sidebar_position: 1
title: Creating a plugin
---

# Creating a Toby plugin

Toby integrations ship as **installable plugins**. All new plugins **must** be
**TypeScript package plugins** (bun-package format) — a directory with a
`manifest.json` and TypeScript entrypoint, executed via Toby's bundled Bun
runtime. No compilation step required.

The only native macOS code in the Toby product is the Toby.app itself. When a
plugin needs macOS framework access (EventKit, Shortcuts, system APIs,
TCC-protected resources), the TypeScript plugin delegates those operations to
Toby.app's native API server rather than compiling its own native binary. See
the macOS and Apple Calendar plugins for reference.

Plugins implement a **protocol v1** contract: Toby passes credentials and session
state on **stdin** and reads **JSON on stdout**. Plugins must **not** read or
write `~/.toby/` directly.

## Choosing a plugin type

| | TypeScript package plugin | Binary plugin (legacy) |
|--| ------------------------ | ---------------------- |
| **Format** | Directory with `manifest.json` + `.ts` entrypoint | Single compiled executable file |
| **Runtime** | Toby's bundled Bun runtime | None — the binary is self-contained |
| **Build step** | None (install the directory directly) | Compile ahead of time |
| **Dependencies** | `package.json` + `node_modules/` (vendored or installed when discovered) | Linked at compile time |
| **Best for** | All new plugins — API integrations, web services, and macOS system controls routed through Toby.app | Existing compiled binaries only — do not create new ones |
| **Reference** | Sample TypeScript plugin, macOS, Apple Calendar | (none — all first-party plugins migrated to bun-package) |

**Rule of thumb:** Always use a TypeScript package plugin. For macOS system
controls and Calendar/EventKit access, route through Toby.app's native API
server from a TypeScript plugin rather than building a native binary.

## TypeScript package plugins (bun-package)

A TypeScript package plugin is a directory containing a `manifest.json`, a
`package.json`, and a TypeScript entrypoint. Toby discovers the directory, reads
the manifest, and invokes the entrypoint with the protocol arguments, with
`cwd` set to the plugin directory.

### Directory layout

```text
my-plugin/
  manifest.json       # required — plugin metadata and runtime config
  package.json        # recommended — dependency declarations
  src/index.ts        # entrypoint declared in manifest
  node_modules/       # optional — vendored dependencies
```

The plugin name comes from the `name` field in `manifest.json` (not the
directory name). Installed plugins live as
`~/.toby/plugins/toby-plugin-<name>/`.

### Manifest format (`manifest.json`)

```json
{
  "name": "myapp",
  "displayName": "My App",
  "description": "Short description for status and configure",
  "version": "1.0.0",
  "protocolVersion": "1",
  "runtime": {
    "type": "bun",
    "entry": "src/index.ts"
  },
  "capabilities": ["chat"],
  "providerCategories": ["tasks"]
}
```

| Field | Required | Meaning |
| ----- | -------- | ------- |
| `name` | yes | Integration id (must match `^[a-z0-9_-]+$`) |
| `displayName` | yes | Human label in the Integrations UI |
| `description` | yes | One-line summary |
| `version` | yes | Plugin release version |
| `protocolVersion` | yes | Must be `"1"` for this spec |
| `runtime.type` | yes | Must be `"bun"` |
| `runtime.entry` | yes | Path to the TypeScript entrypoint, relative to the plugin directory |
| `capabilities` | no | Used for fast discovery filtering; `status` is the runtime source of truth. Default `["chat"]` |
| `providerCategories` | no | e.g. `email`, `calendar`, `tasks`, `contacts`, `chat`, `documents`, `work_tracker` |

### Bun runtime resolution

Toby resolves the Bun runtime in the following order:

1. `TOBY_BUN_PATH` environment variable (explicit override)
2. `~/.toby/helpers/bun` (bundled in release installs)
3. `bun` on `PATH` (development mode)

Release builds bundle a Bun binary so TypeScript plugins work without a
user-installed global `bun`.

### Install for local use

First-party plugins are already installed with Toby.app. For a custom plugin:

1. Copy (or symlink) your plugin directory to
   `~/.toby/plugins/toby-plugin-<name>/`.
2. Ensure `manifest.json` has a valid `name` and runtime entry.
3. Restart Toby.app (or use **`/restart-server`** in chat) so discovery reloads.
4. Open **Integrations** — your plugin should appear by its display name.
5. Enter credentials, click **Connect**, and try tools in chat.

If `node_modules/` is not present, Toby may install dependencies with the
bundled Bun runtime when it first loads the plugin. For production plugins,
vendor `node_modules/` so install does not need network access.

### Invocation (protocol)

Toby invokes the entrypoint with the same argv matrix as binary plugins. You
normally do not run these yourself—the app does when you open Integrations,
click Connect, or use tools in chat:

```text
<bun-path> run ./src/index.ts status
<bun-path> run ./src/index.ts tools list
<bun-path> run ./src/index.ts tools execute
```

The JSON protocol (stdin/stdout/stderr, exit codes, subcommands) is identical to
binary plugins. See the [protocol subcommands](#protocol-subcommands) section
below for the full contract.

## Binary plugins (legacy)

Binary plugins are standalone executables that Toby spawns directly. They are
language-agnostic — any compiled binary works as long as it implements the
protocol. **Do not create new binary plugins.** All new plugins must be
TypeScript package plugins.

:::note[Legacy format]

Binary plugins exist for historical reasons. All first-party plugins have been
migrated to TypeScript bun-package format. For macOS framework access, use a
TypeScript plugin that delegates to Toby.app's native API server.

:::

For each operation (connect, list tools, run a tool, …), Toby spawns your binary
once, passes optional JSON on stdin, reads one JSON object from stdout, and
checks the exit code:

```text
~/.toby/plugins/toby-plugin-myapp <command> [subcommand]
```

Examples of what Toby runs internally:

```text
~/.toby/plugins/toby-plugin-myapp status
~/.toby/plugins/toby-plugin-myapp connect          # stdin: config envelope
~/.toby/plugins/toby-plugin-myapp config shape
~/.toby/plugins/toby-plugin-myapp tools list
~/.toby/plugins/toby-plugin-myapp tools execute    # stdin: tool request JSON
```

After the response is parsed, the subprocess exits. Chat tools and connect flows
all use this same one-shot pattern.

## Plugin naming and discovery

Both plugin formats use the same naming convention and discovery locations.

| Rule | Detail |
| ---- | ------ |
| **Name** | `toby-plugin-<name>` where `<name>` matches `^[a-z0-9_-]+$` (this becomes the integration id). For TypeScript plugins, `<name>` comes from `manifest.json`. For binary plugins, it's the filename. |
| **Location** | `~/.toby/plugins/` (or `$TOBY_DIR/plugins/` when `TOBY_DIR` is set) |
| **Binary permissions** | Binary plugins must be executable |
| **Collisions** | The name must not match an existing built-in integration |

Toby discovers plugins primarily from `~/.toby/plugins/` after install. Place
your plugin there and restart the app (or restart the local service from chat)
to pick up changes.

## Streams, exit codes, and limits

### stdin, stdout, stderr

| Stream | Rule |
| ------ | ---- |
| **stdin** | UTF-8 JSON when the subcommand requires it; empty or omitted otherwise |
| **stdout** | Exactly **one** JSON object, then exit—no log prefixes, banners, or trailing text |
| **stderr** | Human-readable diagnostics only; Toby may show stderr on failure but never parses it |

When stdin is empty for envelope-based commands, treat `config` and `state` as `{}`.

### Exit codes

| Code | Meaning |
| ---- | ------- |
| `0` | Success (`ok: true` in JSON) |
| `1` | Business failure (`ok: false`) |
| `2` | Contract or usage error (bad argv, malformed JSON, unknown subcommand) |

Unknown commands or invalid usage should exit **`2`** with JSON like
`{ "ok": false, "error": "…", "code?": "…" }`.

### Timeouts

Each subprocess has a **120 second** timeout and **4 MiB** stdout limit.
Long-running API work must finish within that window.

## Config envelope (stdin)

Many subcommands read a JSON object from stdin:

```json
{
  "config": {
    "apiKey": "example"
  },
  "state": {
    "connectedAt": "2026-05-31T12:00:00.000Z"
  }
}
```

| Field | Meaning |
| ----- | ------- |
| `config` | Credential and integration fields Toby stores in `credentials.json` (namespaced as `<name>.<key>` in the Integrations UI) |
| `state` | Session fields Toby stores in `config.json` for this integration |
| `validateTools` | Optional on `status` only—when `true`, return per-tool health rows (see [status](#status)) |

## Protocol subcommands

Every plugin should implement the subcommands in this table. Toby invokes them
when you use Integrations, Connect, or chat tools.

| argv | stdin | stdout | When Toby runs it |
| ---- | ----- | ------ | ----------------- |
| `status` | Optional [config envelope](#config-envelope-stdin) | [Status response](#status) | Integrations list/detail, health checks |
| `connect` | Config envelope | `{ ok, reason?, config? }` | **Connect** button in Integrations |
| `disconnect` | Optional config envelope | `{ ok, reason?, config? }` | **Disconnect** button in Integrations |
| `config shape` | *(none)* | `{ ok, fields? }` | Integrations field definitions |
| `config get` | Config envelope | `{ ok, config? }` | Normalized credential readback |
| `config set` | Config envelope | `{ ok }` | Optional hook after Toby saves credentials |
| `tools list` | *(none)* | `{ ok, tools? }` | Chat tool catalog |
| `tools execute` | [Tool request](#tools-execute) | [Tool response](#tools-execute) | Chat tool execution |
| `setup` | Optional config envelope | [Setup response](#setup-optional) | Optional one-time setup from the integration detail |
| `setup guide` | Optional config envelope | [Setup guide response](#setup-guide-optional) | **Setup Guide** wizard in Toby.app |

---

### `status`

Reports plugin identity, protocol version, connection state, and metadata used
by the Integrations UI and health checks.

**stdin:** optional config envelope.

**stdout (success):**

```json
{
  "ok": true,
  "name": "myapp",
  "displayName": "My App",
  "description": "Short description for status and configure",
  "version": "1.0.0",
  "protocolVersion": "1",
  "connected": true,
  "capabilities": ["chat"],
  "providerCategories": ["tasks"],
  "details": "API key configured."
}
```

| Field | Required | Meaning |
| ----- | -------- | ------- |
| `ok` | yes | Must be `true` on success |
| `name` | yes | Integration id (matches plugin name) |
| `displayName` | yes | Human label in the Integrations UI |
| `description` | yes | One-line summary |
| `version` | yes | Plugin release version |
| `protocolVersion` | yes | Must be `"1"` for this spec |
| `connected` | yes | Whether Toby should treat the integration as connected |
| `capabilities` | no | Default `["chat"]`. May include `"inbound"` for @mention listening |
| `providerCategories` | no | e.g. `email`, `calendar`, `tasks`, `contacts`, `chat`, `documents`, `work_tracker` |
| `details` | no | Extra status text |
| `resources` | no | Arbitrary tags for status output |
| `setupAvailable` | no | `true` when the plugin implements `setup` |
| `setupDescription` | no | Short label for setup in the Integrations UI |

**Optional extensions on `status`:**

- **`authMethods`** — OAuth or multi-method auth:

  ```json
  "authMethods": [
    { "id": "oauth_pkce", "label": "OAuth (PKCE)", "isDefault": true },
    { "id": "api_key", "label": "API Key" }
  ]
  ```

- **`chatModelPrep`** — **Required** when `capabilities` includes `"chat"`. Supplies integration-specific prompt sections Toby merges with personas and global tool guidance:

  ```json
  "chatModelPrep": {
    "systemPromptSection": "### My App\nShort block for multi-integration chat.",
    "singleSessionRules": "You are Toby…\nRules:\n- …",
    "singleSessionUserTemplate": "User request:\n{{userPrompt}}",
    "multiUserContentTemplate": "## My App\n…\n{{userPrompt}}"
  }
  ```

  Use `{{userPrompt}}` in templates where the user's message should appear.

- **`chatReadiness`** — When stdin includes a config envelope, tell the chat UI whether the integration is ready:

  ```json
  "chatReadiness": {
    "ok": false,
    "hint": "Open Integrations, save credentials, then click Connect."
  }
  ```

- **`tools`** — When stdin has `"validateTools": true`, return per-tool health rows:

  ```json
  "tools": [
    { "tool": "myTool", "ok": true, "details": "Reachable." }
  ]
  ```

---

### `connect`

Validates configuration and confirms the integration can be used. Invoked when
you click **Connect** in Integrations.

**stdin:** config envelope (required `config`).

**stdout:**

```json
{ "ok": true, "reason": "Connected successfully." }
```

or

```json
{ "ok": false, "reason": "API key is required." }
```

When `ok` is `true`, Toby writes `connectedAt` into integration state. You may
return a **`config`** object to persist tokens or normalized fields (OAuth
access/refresh tokens, etc.); Toby merges it into stored credentials.

---

### `disconnect`

Acknowledges disconnect. Toby clears session state regardless; use this to
release remote resources or wipe sensitive credential fields via a **`config`**
writeback.

**stdin:** optional config envelope.

**stdout:**

```json
{ "ok": true, "reason": "Disconnected." }
```

---

### `config shape`

Returns field definitions for **Integrations → your plugin**. Toby namespaces
keys as `<name>.<key>`.

**stdin:** none.

**stdout:**

```json
{
  "ok": true,
  "fields": [
    {
      "key": "apiKey",
      "label": "API Key",
      "type": "string",
      "required": true,
      "masked": true
    }
  ]
}
```

| Field property | Meaning |
| -------------- | ------- |
| `key` | Local field id (Toby prefixes with integration name) |
| `label` | UI label |
| `type` | `string`, `number`, `boolean`, or `select` |
| `required`, `masked`, `multiline` | Optional UI behavior |
| `options` | Required for `select` type |
| `default`, `pattern`, `minLength`, `maxLength`, `description` | Optional validation and help text |
| `showForAuthMethods` | Optional list of auth method ids—show field only for those methods |

---

### `config get`

Optional normalization hook. Toby already stores values from the Integrations
UI; this subcommand lets the plugin return cleaned or inferred config.

**stdin:** config envelope.

**stdout:**

```json
{
  "ok": true,
  "config": { "apiKey": "example", "authMethod": "api_key" }
}
```

---

### `config set`

Optional sync hook after Toby saves credentials (remote registration,
hydration, etc.).

**stdin:** config envelope.

**stdout:**

```json
{ "ok": true }
```

---

### `tools list`

Returns the chat tool catalog for this integration.

**stdin:** none.

**stdout:**

```json
{
  "ok": true,
  "tools": [
    {
      "name": "myappEcho",
      "description": "Echo a message back",
      "readOnly": true,
      "inputSchema": {
        "type": "object",
        "properties": {
          "message": { "type": "string", "description": "Text to echo" }
        },
        "required": ["message"]
      }
    }
  ]
}
```

Each tool requires `name`, `description`, and `inputSchema` (JSON Schema object
root with `properties`, `required`, and primitive types). Optional: `readOnly`
(default `false`). Mark read-only tools when they do not mutate remote state;
Toby may cache their results within a chat turn.

---

### `tools execute`

Runs one tool during chat.

**stdin:**

```json
{
  "tool": "myappEcho",
  "input": { "message": "hello" },
  "config": { "apiKey": "example" },
  "state": {},
  "dryRun": false
}
```

| Field | Meaning |
| ----- | ------- |
| `tool` | Tool name from `tools list` |
| `input` | Arguments matching the tool's `inputSchema` |
| `config` / `state` | Current integration config and session state |
| `dryRun` | When `true`, mutating tools should preview changes without applying them |

**stdout (success):**

```json
{
  "ok": true,
  "result": { "echo": "hello" },
  "appliedActions": ["Echoed message"]
}
```

| Field | Meaning |
| ----- | ------- |
| `result` | JSON value returned to the model (structure is up to your plugin) |
| `appliedActions` | Human-readable lines describing side effects (shown in the chat transcript) |
| `config` | Optional writeback (token refresh, updated remote ids, etc.) |

**stdout (failure):**

```json
{
  "ok": false,
  "error": "Unknown tool: missing"
}
```

Honor **`dryRun`** for mutating tools. Return **`appliedActions`** whenever the
tool would change something in production mode.

---

### `setup` (optional)

For one-time setup (installing macOS Shortcuts, downloading models, etc.).
Advertise on `status` with `setupAvailable: true` and optional
`setupDescription`.

**stdin:** optional config envelope.

**stdout:**

```json
{
  "ok": true,
  "actions": [
    {
      "id": "step-one",
      "label": "Install helper shortcut",
      "ok": true,
      "skipped": true,
      "detail": "Already installed."
    },
    {
      "id": "step-two",
      "label": "Open import dialog",
      "ok": true,
      "detail": "Complete the import in Shortcuts.app."
    }
  ]
}
```

| Action field | Required | Meaning |
| ------------ | -------- | ------- |
| `id` | yes | Stable machine id |
| `label` | yes | Human-readable step name |
| `ok` | yes | Step succeeded (including already satisfied when `skipped: true`) |
| `skipped` | no | Step not run because prerequisites are already met |
| `detail` | no | Extra explanation for the user |

Top-level `ok: true` means the setup command ran. Use top-level `ok: false` only
for fatal errors. Individual step failures can set `ok: false` on that action
while top-level `ok` stays `true`.

Setup is **idempotent**—plugins detect whether work is already done; Toby does
not persist setup completion separately.

---

### `setup guide` (optional)

Provide a guided onboarding experience for **Toby.app**. When a user opens an
integration and taps **Setup Guide**, Toby runs `setup guide` on the plugin and
renders the returned steps.

**stdin:** optional config envelope.

**stdout:**

```json
{
  "ok": true,
  "name": "myapp",
  "displayName": "My App",
  "description": "Short description for the wizard header",
  "steps": [
    {
      "id": "overview",
      "title": "What My App can do",
      "description": "One or two sentences about the integration."
    },
    {
      "id": "provider",
      "title": "Create credentials in the provider console",
      "links": [
        { "label": "Open provider console", "url": "https://example.com/apps" }
      ],
      "artifacts": [
        {
          "id": "redirectUri",
          "label": "Redirect URI",
          "value": "http://localhost:9876/callback",
          "hint": "Paste this into the provider's OAuth redirect settings."
        }
      ]
    },
    {
      "id": "credentials",
      "title": "Add credentials",
      "description": "Paste the API key or client secret into the fields below."
    },
    {
      "id": "validate",
      "title": "Validate",
      "description": "Toby will run a health check to confirm the integration is ready."
    }
  ]
}
```

| Step field | Required | Meaning |
| ---------- | -------- | ------- |
| `id` | yes | Stable machine id |
| `title` | yes | Heading shown in the wizard |
| `description` | no | Longer explanation |
| `links` | no | Array of `{ label, url }` buttons |
| `artifacts` | no | Array of `{ id, label, value, hint? }` copyable values |

If your plugin does not implement `setup guide`, Toby builds a generic guide
from `status`, `config shape`, and `authMethods`. Custom guides are especially
useful for OAuth integrations so users know exactly which redirect URI and
scopes to use.

---

## Inbound chat (optional, advanced)

Plugins that listen for @mentions or DMs in a chat platform declare `"inbound"`
in `capabilities` (in addition to `"chat"` for tools). Inbound uses a
**different transport**: a long-lived subprocess and **newline-delimited JSON**
(NDJSON), not the one-shot contract above.

```text
toby-plugin-<name> inbound run
```

| Stream | Rule |
| ------ | ---- |
| **stdin** | One JSON object per line (messages from Toby) |
| **stdout** | One JSON object per line (messages to Toby) |
| **stderr** | Diagnostics only |

Toby starts `inbound run` when inbound is enabled for that integration and the
local service is running. The process stays alive until Toby sends
`{ "type": "shutdown" }` or the service stops.

Optional `status.inboundPrep` metadata:

```json
"inboundPrep": {
  "externalKeyFormat": "slack:{teamId}:{channelId}:{threadRootTs}",
  "transportLabel": "socket_mode"
}
```

**Plugin → Toby (stdout lines):**

| `type` | Meaning |
| ------ | ------- |
| `ready` | Transport connected |
| `event` | Normalized inbound user message |
| `personaAppendix` | Response to a persona appendix request |
| `error` | Fatal transport error |

**Toby → plugin (stdin lines):**

| `type` | Meaning |
| ------ | ------- |
| `start` | Initial `config`, `state`, `dryRun`—connect transport, then emit `ready` |
| `config` | Credential patch while running |
| `deliverReply` | Post assistant reply to a conversation |
| `deliverAskUser` | Post an askUser prompt |
| `statusUpdate` / `statusClear` | Transient status UI in the chat platform |
| `getPersonaAppendix` | Request persona-specific appendix text for a turn |
| `shutdown` | Stop and exit |

See the Slack integration guide for a full inbound user setup, and the Slack
plugin in the Toby repository for a reference implementation.

## Test your plugin in Toby.app

| Step | Where |
| ---- | ----- |
| Confirm discovery | **Integrations** sidebar — your display name appears |
| Enter credentials | Integration detail page (fields from `config shape`) |
| Connect | **Connect** button (runs `connect`) |
| Check health | Status on the detail page and Integrations list (runs `status`) |
| Optional setup | Setup action if `setupAvailable` is true |
| Onboarding wizard | **Setup Guide** if you implement `setup guide` |
| Use tools | Chat, with the integration selected or mentioned |

To remove a custom plugin: quit Toby.app, delete
`~/.toby/plugins/toby-plugin-<name>/`, and remove any leftover entries for that
name under `~/.toby/credentials.json` and `~/.toby/config.json` if needed.

## Authoring checklist

### For all plugins

1. Implement all core subcommands with single-object JSON on stdout and stable exit codes.
2. Accept config via stdin; never read `~/.toby/` from the plugin process.
3. Declare at least one chat tool in `tools list` when `capabilities` includes `"chat"`.
4. Return `chatModelPrep` on `status` for chat-capable plugins.
5. Honor `dryRun` in `tools execute` for mutating tools.
6. Return `appliedActions` strings when tools change remote state.
7. Install under `~/.toby/plugins/`, restart Toby.app, then Connect and chat-test.
8. Optional: implement `setup` and set `setupAvailable` on `status`.
9. Optional: implement `setup guide` for a native-app onboarding wizard.
10. Optional: implement `inbound run` when the integration should respond to @mentions.

### Additional steps for TypeScript package plugins

1. Create a `manifest.json` with `name`, `displayName`, `description`, `version`, `protocolVersion`, and `runtime.type: "bun"` / `runtime.entry`.
2. Ensure the `name` field matches the desired integration id (`^[a-z0-9_-]+$`).
3. Include a `package.json` for dependency management.
4. Vendor `node_modules/` or allow Toby to install dependencies when the plugin is first loaded.

### Additional steps for binary plugins (legacy only)

**Do not create new binary plugins.** These steps apply only to maintaining
existing compiled binaries until they are migrated to bun-package format.

1. Name the binary `toby-plugin-<name>` and make it executable.
2. Compile to a standalone executable that implements the protocol above.

## Reference implementations

The Toby repository includes working plugins you can copy from (paths under
`apps/plugin-*` in the source tree):

| Plugin | Format | Notes |
| ------ | ------ | ----- |
| Sample TypeScript plugin | TypeScript package | Minimal bun-package plugin—start here for API integrations |
| Email | TypeScript package | IMAP/SMTP email, auth methods, config writeback |
| Todoist | TypeScript package | API key auth, task tools |
| Slack | TypeScript package | Chat tools + `inbound run` (Socket Mode) |
| Jira | TypeScript package | Read-only Jira REST API integration |
| Notion | TypeScript package | Documents provider |
| Apple Calendar | TypeScript package | EventKit via Toby.app native API |
| Apple Contacts | TypeScript package | Contacts via Toby.app native API |
| Apple Reminders | TypeScript package | EventKit reminders via Toby.app native API |
| macOS | TypeScript package | System controls via Toby.app native API; optional `setup` for Shortcuts |

Release archives bundle first-party plugins into `~/.toby/plugins/`
automatically with Toby.app.

## Next steps

- [Integrations overview](../integrations/overview) — connect and use plugins from chat
- [Configure and connect](../getting-started/configure-and-status) — credentials and Connect in the UI
- Toby repo: `docs/plugin-protocol.md` — full protocol spec for contributors and agents
