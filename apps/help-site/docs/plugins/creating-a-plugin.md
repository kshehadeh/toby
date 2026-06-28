---
sidebar_position: 1
title: Creating a plugin
---

# Creating a Toby plugin

Toby integrations can ship as **installable plugins**. There are two plugin formats:

- **TypeScript package plugins** (recommended for most integrations) — a directory with a `manifest.json` and TypeScript entrypoint, executed via Toby's bundled Bun runtime. No compilation step required.
- **Binary plugins** (recommended for deep macOS integrations) — standalone compiled executables that Toby spawns directly. Language-agnostic, no runtime dependency on the host.

Both formats implement the same **protocol v1** contract: Toby passes credentials and session state on **stdin** and reads **JSON on stdout**. Plugins must **not** read or write `~/.toby/` directly.

## Choosing a plugin type

| | TypeScript package plugin | Binary plugin |
|--| ------------------------ | -------------- |
| **Format** | Directory with `manifest.json` + `.ts` entrypoint | Single compiled executable file |
| **Runtime** | Toby's bundled Bun runtime | None — the binary is self-contained |
| **Build step** | None (install the directory directly) | Compile with `bun build --compile`, SwiftPM, etc. |
| **Dependencies** | `package.json` + `node_modules/` (vendored or installed at install time) | Linked at compile time |
| **Best for** | API integrations, web services, most third-party plugins | Deep macOS integrations (EventKit, Shortcuts, system APIs) |
| **Reference** | `toby-plugin-sample-ts`, `toby-plugin-macos`, `toby-plugin-applecalendar` | `toby-plugin-websearch` |

**Rule of thumb:** Use a TypeScript package plugin unless your integration needs direct access to macOS frameworks that cannot be routed through Toby.app's native API server. For macOS system controls and Calendar/EventKit access, route through Toby.app's native API server from a TypeScript plugin (as `toby-plugin-macos` and `toby-plugin-applecalendar` do) rather than building a Swift binary.

## TypeScript package plugins (bun-package)

A TypeScript package plugin is a directory containing a `manifest.json`, a `package.json`, and a TypeScript entrypoint. Toby discovers the directory, reads the manifest, and invokes the entrypoint via `bun run <entry> <args>` with `cwd` set to the plugin directory.

### Directory layout

```text
my-plugin/
  manifest.json       # required — plugin metadata and runtime config
  package.json        # recommended — dependency declarations
  src/index.ts        # entrypoint declared in manifest
  node_modules/       # optional — vendored dependencies
```

The plugin name comes from the `name` field in `manifest.json` (not the directory name). Toby installs the directory as `~/.toby/plugins/toby-plugin-<name>/`.

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
| `name` | yes | Integration CLI name (must match `^[a-z0-9_-]+$`) |
| `displayName` | yes | Human label in UI and status |
| `description` | yes | One-line summary |
| `version` | yes | Plugin release version |
| `protocolVersion` | yes | Must be `"1"` for this spec |
| `runtime.type` | yes | Must be `"bun"` |
| `runtime.entry` | yes | Path to the TypeScript entrypoint, relative to the plugin directory |
| `capabilities` | no | Used for fast discovery filtering; `status` is the runtime source of truth. Default `["chat"]` |
| `providerCategories` | no | e.g. `email`, `calendar`, `tasks`, `contacts`, `chat`, `search`, `work_tracker` |

### Bun runtime resolution

Toby resolves the Bun runtime in the following order:

1. `TOBY_BUN_PATH` environment variable (explicit override)
2. `~/.toby/helpers/bun` (bundled in release installs)
3. `bun` on `PATH` (development mode)

Release builds bundle a Bun binary so TypeScript plugins work without a user-installed global `bun`.

### Install and dependencies

```bash
# Install the directory directly — no build step needed
toby plugins install ./my-plugin

# Or symlink for local development
toby plugins install ./my-plugin --link --force
```

If `node_modules/` is not present in the plugin directory, Toby runs `bun install` automatically at install time (best-effort, requires a Bun runtime). For production plugins, vendor `node_modules/` to avoid network dependency at install time.

### Invocation

Toby invokes the entrypoint with the same argv matrix as binary plugins:

```bash
<bun-path> run ./src/index.ts status
<bun-path> run ./src/index.ts tools list
<bun-path> run ./src/index.ts tools execute
```

The JSON protocol (stdin/stdout/stderr, exit codes, subcommands) is identical to binary plugins. See the [protocol subcommands](#protocol-subcommands) section below for the full contract.

## Binary plugins

Binary plugins are standalone executables that Toby spawns directly. They are language-agnostic — any compiled binary works as long as it implements the protocol.

:::note[When to use a binary]

Binary plugins are recommended when your integration needs **deep macOS integration** — direct access to system frameworks like EventKit (Calendar), Contacts, Shortcuts, or AudioToolbox. Swift-based binary plugins can use these frameworks natively.

For API-based integrations (REST APIs, OAuth flows, web services), prefer TypeScript package plugins instead — they're simpler to author and don't require a compilation step.

:::

Toby uses ordinary process spawn on the binary path. Your plugin does not need Bun, Node, or any particular runtime on the user's machine—only your compiled executable (or script with a shebang).

For each operation (connect, list tools, run a tool, …), Toby spawns your binary once, passes optional JSON on stdin, reads one JSON object from stdout, and checks the exit code:

```text
~/.toby/plugins/toby-plugin-myapp <command> [subcommand]
```

Examples:

```bash
~/.toby/plugins/toby-plugin-myapp status
~/.toby/plugins/toby-plugin-myapp connect          # stdin: config envelope
~/.toby/plugins/toby-plugin-myapp config shape
~/.toby/plugins/toby-plugin-myapp tools list
~/.toby/plugins/toby-plugin-myapp tools execute    # stdin: tool request JSON
```

After the response is parsed, the subprocess exits. Chat tools and connect flows all use this same one-shot pattern.

## Plugin naming and discovery

Both plugin formats use the same naming convention and discovery locations.

| Rule | Detail |
| ---- | ------ |
| **Name** | `toby-plugin-<name>` where `<name>` matches `^[a-z0-9_-]+$` (this becomes the CLI integration name). For TypeScript plugins, `<name>` comes from `manifest.json`. For binary plugins, it's the filename. |
| **Location** | `~/.toby/plugins/` (or `$TOBY_DIR/plugins/` when `TOBY_DIR` is set) |
| **Binary permissions** | Binary plugins must be executable (`chmod +x`) |
| **Collisions** | The name must not match an existing built-in integration |

Toby discovers plugins from these locations, in precedence order:

1. The directory containing the running `toby` binary (for development)
2. The repository's `dist/` directory (for local development)
3. `~/.toby/plugins/` (for installed plugins)

Install with `toby plugins install <path>` (accepts a binary file, a directory with a binary, or a TypeScript plugin directory with `manifest.json`). Run `toby plugins list` to confirm discovery.

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

Unknown commands or invalid usage should exit **`2`** with JSON like `{ "ok": false, "error": "…", "code?": "…" }`.

### Timeouts

Each subprocess has a **25 second** timeout and **4 MiB** stdout limit. Long-running API work must finish within that window.

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
| `config` | Credential and integration fields Toby stores in `credentials.json` (namespaced as `<name>.<key>` in the configure UI) |
| `state` | Session fields Toby stores in `config.json` for this integration |
| `validateTools` | Optional on `status` only—when `true`, return per-tool health rows (see [status](#status)) |

## Protocol subcommands

Every plugin should implement the subcommands in this table. Toby invokes them with the argv shown.

| argv | stdin | stdout | Purpose |
| ---- | ----- | ------ | ------- |
| `status` | Optional [config envelope](#config-envelope-stdin) | [Status response](#status) | Identity, health, chat prep, doctor checks |
| `connect` | Config envelope | `{ ok, reason?, config? }` | `toby connect <name>` |
| `disconnect` | Optional config envelope | `{ ok, reason?, config? }` | `toby disconnect <name>` |
| `config shape` | *(none)* | `{ ok, fields? }` | Configure UI field definitions |
| `config get` | Config envelope | `{ ok, config? }` | Normalized credential readback |
| `config set` | Config envelope | `{ ok }` | Optional hook after Toby saves credentials |
| `tools list` | *(none)* | `{ ok, tools? }` | Chat tool catalog |
| `tools execute` | [Tool request](#tools-execute) | [Tool response](#tools-execute) | Run one chat tool |
| `setup` | Optional config envelope | [Setup response](#setup-optional) | One-time setup (`toby plugins setup`) |
| `setup guide` | Optional config envelope | [Setup guide response](#setup-guide-optional) | Onboarding wizard in Toby.app |

---

### `status`

Reports plugin identity, protocol version, connection state, and metadata used by `toby status`, the configure UI, and `toby plugins doctor`.

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
| `name` | yes | Integration CLI name (matches binary suffix) |
| `displayName` | yes | Human label in UI and status |
| `description` | yes | One-line summary |
| `version` | yes | Plugin release version |
| `protocolVersion` | yes | Must be `"1"` for this spec |
| `connected` | yes | Whether Toby should treat the integration as connected |
| `capabilities` | no | Default `["chat"]`. May include `"inbound"` for daemon @mention listening |
| `providerCategories` | no | e.g. `email`, `calendar`, `tasks`, `contacts`, `chat`, `search`, `work_tracker` |
| `details` | no | Extra status text |
| `resources` | no | Arbitrary tags for status output |
| `setupAvailable` | no | `true` when the plugin implements `setup` |
| `setupDescription` | no | Short label for setup in configure / install prompts |

**Optional extensions on `status`:**

- **`authMethods`** — OAuth or multi-method auth, same shape as built-in integrations:

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
    "hint": "Run `toby connect myapp` after configuring credentials."
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

Validates configuration and confirms the integration can be used. Invoked by `toby connect <name>`.

**stdin:** config envelope (required `config`).

**stdout:**

```json
{ "ok": true, "reason": "Connected successfully." }
```

or

```json
{ "ok": false, "reason": "API key is required." }
```

When `ok` is `true`, Toby writes `connectedAt` into integration state. You may return a **`config`** object to persist tokens or normalized fields (OAuth access/refresh tokens, etc.); Toby merges it into stored credentials.

---

### `disconnect`

Acknowledges disconnect. Toby clears session state regardless; use this to release remote resources or wipe sensitive credential fields via a **`config`** writeback.

**stdin:** optional config envelope.

**stdout:**

```json
{ "ok": true, "reason": "Disconnected." }
```

---

### `config shape`

Returns field definitions for **Configure → Integrations**. Toby namespaces keys as `<name>.<key>`.

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

Optional normalization hook. Toby already stores values from the configure UI; this subcommand lets the plugin return cleaned or inferred config.

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

Optional sync hook after Toby saves credentials (remote registration, hydration, etc.).

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

Each tool requires `name`, `description`, and `inputSchema` (JSON Schema object root with `properties`, `required`, and primitive types). Optional: `readOnly` (default `false`). Mark read-only tools when they do not mutate remote state; Toby may cache their results within a chat turn.

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

Honor **`dryRun`** for mutating tools. Return **`appliedActions`** whenever the tool would change something in production mode.

---

### `setup` (optional)

For one-time setup (installing macOS Shortcuts, downloading models, etc.). Advertise on `status` with `setupAvailable: true` and optional `setupDescription`.

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

Top-level `ok: true` means the setup command ran. Use top-level `ok: false` only for fatal errors. Individual step failures can set `ok: false` on that action while top-level `ok` stays `true`.

Setup is **idempotent**—plugins detect whether work is already done; Toby does not persist setup completion separately.

---

### `setup guide` (optional)

Provide a guided onboarding experience for the native **Toby.app**. When a user opens an integration in the app's configure view and taps **Setup Guide**, Toby runs `toby-plugin-<name> setup guide` and renders the returned steps.

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

If your plugin does not implement `setup guide`, Toby builds a generic guide from `status`, `config shape`, and `authMethods`. Custom guides are especially useful for OAuth integrations so users know exactly which redirect URI and scopes to use.

---

## Inbound chat (optional, advanced)

Plugins that listen for @mentions or DMs in a chat platform declare `"inbound"` in `capabilities` (in addition to `"chat"` for tools). Inbound uses a **different transport**: a long-lived subprocess and **newline-delimited JSON** (NDJSON), not the one-shot contract above.

```text
toby-plugin-<name> inbound run
```

| Stream | Rule |
| ------ | ---- |
| **stdin** | One JSON object per line (messages from Toby) |
| **stdout** | One JSON object per line (messages to Toby) |
| **stderr** | Diagnostics only |

Toby spawns `inbound run` when the daemon starts inbound for that integration. The process stays alive until Toby sends `{ "type": "shutdown" }` or the daemon stops.

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

See the Slack plugin in the Toby repository for a full inbound reference.

## Managing plugins (Toby commands)

| Command | Purpose |
| ------- | ------- |
| `toby plugins list` | List discovered binaries under `~/.toby/plugins/` |
| `toby plugins install <path>` | Validate and copy (or symlink) a plugin into the plugins directory |
| `toby plugins doctor` | Validate naming, `status`, protocol version, and `tools list` for every discovered plugin |
| `toby plugins inspect <name>` | Show metadata and tool catalog for one plugin |
| `toby plugins setup <name>` | Run optional one-time setup |
| `toby plugins uninstall <name>` | Remove the binary and purge stored credentials, config, defaults, and cached tool results |

**`install` flags:**

| Flag | Effect |
| ---- | ------ |
| `--force` | Overwrite an existing managed install |
| `--link` | Symlink instead of copy (useful while developing locally) |
| `--setup` | Run setup after install without prompting (requires a TTY when setup needs interaction) |
| `--no-setup` | Skip the post-install setup prompt |

`install` validates the same checks as `doctor`: binary name, successful `status`, supported `protocolVersion`, and parseable `tools list`. It rejects names that collide with built-in integrations.

After install:

```bash
toby plugins doctor
toby config          # configure credentials
toby connect myapp
toby status integration -i myapp
toby chat --integration myapp "try my tools"
```

## Authoring checklist

### For all plugins

1. Implement all core subcommands with single-object JSON on stdout and stable exit codes.
2. Accept config via stdin; never read `~/.toby/` from the plugin process.
3. Declare at least one chat tool in `tools list` when `capabilities` includes `"chat"`.
4. Return `chatModelPrep` on `status` for chat-capable plugins.
5. Honor `dryRun` in `tools execute` for mutating tools.
6. Return `appliedActions` strings when tools change remote state.
7. Install with `toby plugins install`, then run `toby plugins doctor`.
8. Optional: implement `setup` and set `setupAvailable` on `status`.
9. Optional: implement `setup guide` for a native-app onboarding wizard.
10. Optional: implement `inbound run` when the integration should respond to daemon @mentions.

### Additional steps for TypeScript package plugins

1. Create a `manifest.json` with `name`, `displayName`, `description`, `version`, `protocolVersion`, and `runtime.type: "bun"` / `runtime.entry`.
2. Ensure the `name` field matches the desired integration CLI name (`^[a-z0-9_-]+$`).
3. Include a `package.json` for dependency management.
4. Vendor `node_modules/` or let Toby run `bun install` at install time.

### Additional steps for binary plugins

1. Name the binary `toby-plugin-<name>` and make it executable (`chmod +x`).
2. Compile with `bun build --compile` (TypeScript) or SwiftPM (Swift) — the output must be a standalone executable.

## Reference implementations

The Toby repository includes working plugins you can copy from:

| Plugin | Format | Language | Notes |
| ------ | ------ | -------- | ----- |
| `toby-plugin-sample-ts` | TypeScript package | TypeScript (Bun runtime) | Minimal bun-package plugin—start here for API integrations |
| `toby-plugin-gmail` | TypeScript package | TypeScript | OAuth, auth methods, token writeback |
| `toby-plugin-todoist` | Bun-package | TypeScript | API key auth, task tools; vendored `@doist/todoist-sdk` |
| `toby-plugin-azuread` | TypeScript package | TypeScript | Full parity migration example |
| `toby-plugin-slack` | TypeScript package | TypeScript | Chat tools + `inbound run` (Socket Mode); `@slack/bolt` |
| `toby-plugin-jira` | Bun-package | TypeScript | Read-only Jira REST API integration |
| `toby-plugin-websearch` | Binary | Swift | API-key search; global `webSearch` bridge in Toby core |
| `toby-plugin-applecalendar` | Bun-package | TypeScript | EventKit calendar operations via Toby.app native API |
| `toby-plugin-macos` | Bun-package | TypeScript | macOS system controls via Toby.app native API; optional `setup` for Shortcuts |

Build and install examples from a git clone:

```bash
# TypeScript package plugin (no build step needed)
toby plugins install ./apps/plugin-sample-ts --link --force

# Binary plugin (requires build step)
bun run build:plugin:websearch
toby plugins install ./dist/toby-plugin-websearch --link --force

toby plugins doctor
```

Release archives bundle first-party plugins into `~/.toby/plugins/` automatically; developers link local builds as shown above.

## Next steps

- [Integrations overview](../integrations/overview) — connect and use plugins from chat
- [Configure and connect](../getting-started/configure-and-status) — credentials and `toby connect`
- Toby repo: `docs/plugin-protocol.md` — full protocol spec for contributors and agents
