---
sidebar_position: 1
title: Creating a plugin
---

# Creating a Toby plugin

Toby integrations can ship as **installable plugins**: standalone executables that Toby discovers, runs as subprocesses, and treats like built-in integrations. A plugin can be written in **any language** (TypeScript compiled with Bun, Swift, Go, Rust, Python, and so on) as long as it implements the **protocol v1** contract below.

Toby remains the source of truth for configuration. Plugins receive credentials and session state on **stdin** and return **JSON on stdout**. They must **not** read or write `~/.toby/` directly.

## How it works

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

:::note[Language-agnostic]

Toby uses ordinary process spawn on the binary path. Your plugin does not need Bun, Node, or any particular runtime on the user's machine—only your compiled executable (or script with a shebang).

:::

## Binary naming and discovery

| Rule | Detail |
| ---- | ------ |
| **Name** | `toby-plugin-<name>` where `<name>` matches `^[a-z0-9_-]+$` (this becomes the CLI integration name) |
| **Location** | `~/.toby/plugins/` (or `$TOBY_DIR/plugins/` when `TOBY_DIR` is set) |
| **Permissions** | The file must be executable (`chmod +x`) |
| **Collisions** | The name must not match an existing built-in integration |

Install with `toby plugins install <path>`, or copy the binary into the plugins directory manually. Run `toby plugins list` to confirm discovery.

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

1. Name the binary `toby-plugin-<name>` and make it executable.
2. Implement all core subcommands with single-object JSON on stdout and stable exit codes.
3. Accept config via stdin; never read `~/.toby/` from the plugin process.
4. Declare at least one chat tool in `tools list` when `capabilities` includes `"chat"`.
5. Return `chatModelPrep` on `status` for chat-capable plugins.
6. Honor `dryRun` in `tools execute` for mutating tools.
7. Return `appliedActions` strings when tools change remote state.
8. Install with `toby plugins install`, then run `toby plugins doctor`.
9. Optional: implement `setup` and set `setupAvailable` on `status`.
10. Optional: implement `inbound run` when the integration should respond to daemon @mentions.

## Reference implementations

The Toby repository includes working plugins you can copy from:

| Plugin | Language | Notes |
| ------ | -------- | ----- |
| `toby-plugin-sample` | TypeScript (Bun `--compile`) | Minimal protocol surface—start here |
| `toby-plugin-gmail` | TypeScript | OAuth, auth methods, token writeback |
| `toby-plugin-todoist` | TypeScript | API key auth, task tools |
| `toby-plugin-azuread` | TypeScript | Full parity migration example |
| `toby-plugin-jira` | Swift | macOS-only, no embedded JS runtime |
| `toby-plugin-websearch` | Swift | API-key search; global `webSearch` bridge in Toby core |
| `toby-plugin-applecalendar` | Swift | EventKit + Calendar.app |
| `toby-plugin-macos` | Swift | System controls; optional `setup` for Shortcuts |
| `toby-plugin-slack` | TypeScript | Chat tools + `inbound run` (Socket Mode) |

Build examples from a git clone:

```bash
bun run build:plugin:sample
toby plugins install ./dist/toby-plugin-sample --link --force
toby plugins doctor
```

Release archives bundle first-party plugins into `~/.toby/plugins/` automatically; developers link local builds as shown above.

## Next steps

- [Integrations overview](../integrations/overview) — connect and use plugins from chat
- [Configure and connect](../getting-started/configure-and-status) — credentials and `toby connect`
- Toby repo: `docs/plugin-protocol.md` — full protocol spec for contributors and agents
