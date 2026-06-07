# Toby plugin protocol (v1)

Installable plugins are standalone executables that implement a fixed subcommand
contract. Toby discovers them, invokes them as subprocesses, and adapts their
responses into the same `IntegrationModule` surface used by first-party
integrations.

Toby remains the **source of truth** for configuration and connection state.
Plugins receive the current config on each invocation and return JSON on stdout.

For the **native helper** pattern (`toby-listener` for audio capture) — a different
argv/JSON contract for thin platform bridges — see [`native-helpers.md`](native-helpers.md).
Plugins own full integration logic (tools, connect, chat prep); helpers do not.

## CLI contract

Plugins are **language-agnostic executables**. Toby uses Node `spawnSync` on the
binary path — no Bun, Node, or Swift runtime is required on the host beyond the
plugin binary itself ([`packages/core/src/integrations/plugins/client.ts`](../packages/core/src/integrations/plugins/client.ts)).

### Binary naming and discovery

Plugin executables must be named:

```text
toby-plugin-<name>
```

where `<name>` matches `/^[a-z0-9_-]+$/` (the integration CLI name).

Toby discovers plugin binaries only under the Toby data directory:

```text
~/.toby/plugins/
```

When `TOBY_DIR` is set, plugins are loaded from `$TOBY_DIR/plugins/` instead.
Install plugins with `toby plugins install <path>` or copy binaries into that
directory manually.

The binary must be **executable** (`chmod +x`). `toby plugins doctor` and
`toby plugins install` validate naming, `status`, protocol version, and
`tools list`.

### Invocation shape

Every call is a **single subprocess** that runs one subcommand and exits:

```text
<absolute-path-to-toby-plugin-<name>> <command> [subcommand]
```

Examples:

```bash
~/.toby/plugins/toby-plugin-sample status
~/.toby/plugins/toby-plugin-gmail connect          # stdin: config envelope
~/.toby/plugins/toby-plugin-gmail config shape
~/.toby/plugins/toby-plugin-gmail tools list
~/.toby/plugins/toby-plugin-gmail tools execute    # stdin: tool request JSON
```

**Subcommand matrix** (what Toby actually runs):

| argv | stdin | stdout JSON | Used for |
| ---- | ----- | ----------- | -------- |
| `status` | optional [config envelope](#config-envelope-stdin) | [status response](#status) | Identity, health, chat prep, `toby plugins doctor` |
| `connect` | config envelope | `{ ok, reason?, config? }` | `toby connect <name>` |
| `disconnect` | optional config envelope | `{ ok, reason?, config? }` | `toby disconnect <name>` |
| `config shape` | *(none)* | `{ ok, fields? }` | Configure UI field defs |
| `config get` | config envelope | `{ ok, config? }` | Normalized credential readback |
| `config set` | config envelope | `{ ok }` | Post-save sync hook |
| `tools list` | *(none)* | `{ ok, tools? }` | Chat tool catalog |
| `tools execute` | [tool request](#tools-execute) | `{ ok, result?, appliedActions?, config?, error? }` | Chat tool runs |
| `setup` | optional [config envelope](#config-envelope-stdin) | [setup response](#setup) | One-time plugin setup (`toby plugins setup`) |

Unknown commands or invalid usage must exit **`2`** with JSON `{ ok: false, error, code? }`.

### stdin, stdout, stderr

| Stream | Rule |
| ------ | ---- |
| **stdin** | UTF-8 JSON when the subcommand requires it; empty or omitted otherwise |
| **stdout** | Exactly **one** JSON object, then exit; no log prefixes or trailing text |
| **stderr** | Human diagnostics only; Toby may surface stderr on failures but does not parse it |

When stdin is empty for envelope-based commands, treat `config` and `state` as `{}`.

### Exit codes

| Code | Meaning |
| ---- | ------- |
| `0` | Success (`ok: true`) |
| `1` | Business failure (`ok: false`) |
| `2` | Contract/usage error (invalid args, malformed plugin output) |

### Timeouts and limits

Default subprocess limits from the Toby harness:

| Limit | Value |
| ----- | ----- |
| Timeout | 25 seconds (`DEFAULT_TIMEOUT_MS` in `client.ts`) |
| stdout max size | 4 MiB |

Long-running tool work (large mailbox searches, batch API calls) must complete
within the timeout or Toby reports a spawn/timeout error. Plugins cannot extend
the timeout from their side today.

### Config ownership

Plugins **must not** read or write `~/.toby/` directly. Toby passes credentials
and session state on stdin and merges optional `config` writeback from responses
into `credentials.json` / `config.json`.

### Reference implementations

| Plugin | Language | Build | Notes |
| ------ | -------- | ----- | ----- |
| [`apps/plugin-sample/`](../apps/plugin-sample/) | TypeScript → Bun `--compile` | `bun run build:plugin:sample` | Minimal protocol surface |
| [`apps/plugin-gmail/`](../apps/plugin-gmail/) | TypeScript → Bun `--compile` | `bun run build:plugin:gmail` | OAuth, auth methods, token writeback |
| [`apps/plugin-todoist/`](../apps/plugin-todoist/) | TypeScript → Bun `--compile` | `bun run build:plugin:todoist` | API key auth, task tools |
| [`apps/plugin-azuread/`](../apps/plugin-azuread/) | TypeScript → Bun `--compile` | `bun run build:plugin:azuread` | Full parity migration |
| [`apps/plugin-jira/`](../apps/plugin-jira/) | Swift (SwiftPM) | `bun run build:plugin:jira` | macOS-only; no embedded JS runtime |

TypeScript plugins route argv in `src/cli.ts`; Swift plugins mirror the same argv
table in their executable entry point. Protocol types shared with the harness live in
[`packages/core/src/integrations/plugins/protocol.ts`](../packages/core/src/integrations/plugins/protocol.ts).

## JSON payloads

### Config envelope (stdin)

Subcommands that need configuration read a JSON object from stdin:

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

- `config` — credential/integration fields owned by Toby (`credentials.json`).
- `state` — optional session fields owned by Toby (`config.json` integration block).

When stdin is empty, treat both as `{}`.

## Subcommands

### `status`

Reports identity, protocol compatibility, and health.

**stdin:** optional config envelope.

**stdout:**

```json
{
  "ok": true,
  "name": "sample",
  "displayName": "Sample Plugin",
  "description": "Reference installable plugin",
  "version": "1.0.0",
  "protocolVersion": "1",
  "connected": true,
  "capabilities": ["chat"],
  "providerCategories": ["search"],
  "details": "API key configured."
}
```

Required fields: `ok`, `name`, `displayName`, `description`, `version`,
`protocolVersion`, `connected`.

Optional: `capabilities` (default `["chat"]`), `providerCategories`, `details`,
`resources`, `setupAvailable`, `setupDescription` (see [Plugin setup](#plugin-setup)).

### `connect`

Validates configuration and confirms the integration can be used.

**stdin:** config envelope (required `config`).

**stdout:**

```json
{ "ok": true, "reason": "Connected successfully." }
```

or

```json
{ "ok": false, "reason": "API key is required." }
```

Toby writes `connectedAt` to `config.json` when `ok` is true.

### `disconnect`

Acknowledges disconnect. Toby clears session state regardless; plugins may
release remote resources here.

**stdin:** optional config envelope.

**stdout:**

```json
{ "ok": true, "reason": "Disconnected." }
```

### `config shape`

Returns configure UI field definitions. Field keys are **local** to the plugin
(Toby namespaces them as `<name>.<key>`).

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

Supported field types: `string`, `number`, `boolean`, `select`.

Optional field properties: `required`, `masked`, `multiline`, `options`
(`select`), `default`, `pattern`, `minLength`, `maxLength`, `description`.

### `config get`

Returns normalized config values from the envelope (validation/normalization
hook). Toby already stores values; this is optional.

**stdin:** config envelope.

**stdout:**

```json
{
  "ok": true,
  "config": { "apiKey": "example" }
}
```

### `config set`

Optional sync after Toby saves credentials (hydration, remote registration).

**stdin:** config envelope.

**stdout:**

```json
{ "ok": true }
```

### `tools list`

Returns the tool catalog for chat.

**stdout:**

```json
{
  "ok": true,
  "tools": [
    {
      "name": "sampleEcho",
      "description": "Echo a message",
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

Each tool requires `name`, `description`, and `inputSchema` (JSON Schema draft
2020-12 subset: `object` root with `properties`, `required`, primitive types,
`enum`).

Optional: `readOnly` (boolean, default `false`).

### `tools execute`

Runs one tool.

**argv:** `tools execute`

**stdin:**

```json
{
  "tool": "sampleEcho",
  "input": { "message": "hello" },
  "config": { "apiKey": "example" },
  "state": {},
  "dryRun": false
}
```

**stdout:**

```json
{
  "ok": true,
  "result": { "echo": "hello" },
  "appliedActions": ["Echoed message"]
}
```

On failure:

```json
{
  "ok": false,
  "error": "Unknown tool: missing"
}
```

## Complex integrations (OAuth, auth methods, chat prep)

Plugins that need the same depth as first-party integrations can use these
**optional, backward-compatible** v1 extensions. Toby merges responses into
`credentials.integrations[<name>]`; plugins must not read `~/.toby/` directly.

### Config writeback

`connect`, `disconnect`, and `tools execute` may return a `config` object.
Toby merges it into stored credentials (for OAuth tokens, disconnect cleanup,
token refresh rotation, etc.):

```json
{ "ok": true, "config": { "oauthAccessToken": "...", "oauthRefreshToken": "..." } }
```

### Auth methods (`status`)

Optional `authMethods` on `status` (same shape as built-in integrations):

```json
"authMethods": [
  { "id": "oauth_pkce", "label": "OAuth (PKCE)", "isDefault": true },
  { "id": "client_credentials", "label": "Client Credentials" }
]
```

`config shape` fields may include `showForAuthMethods` to gate configure UI
fields (Toby namespaces keys as `<name>.<key>`).

### Config normalization (`config get`)

Return normalized values from the stdin envelope, including inferred fields
such as `authMethod`.

### Deep health probes (`status` + `validateTools`)

Stdin envelope may include `"validateTools": true`. Response may include per-tool
rows (same semantics as `toby status integration --validate-tools`):

```json
"tools": [
  { "tool": "tokenPermissions", "ok": true, "details": "Token permissions OK (delegated)." }
]
```

### Chat model prep (`status.chatModelPrep`)

Required when `capabilities` includes `"chat"`. Plugin supplies integration
rules; Toby wraps them with persona composition and global chat-tool guidance:

```json
"chatModelPrep": {
  "systemPromptSection": "### My Integration\nShort block for multi-integration prompts.",
  "singleSessionRules": "You are Toby...\nRules:\n- ...",
  "singleSessionUserTemplate": "User request:\n{{userPrompt}}",
  "multiUserContentTemplate": "## My Integration\n...\n{{userPrompt}}"
}
```

Use `{{userPrompt}}` placeholders in templates.

### Chat readiness (`status.chatReadiness`)

When `status` receives a config envelope, return readiness for the chat picker:

```json
"chatReadiness": { "ok": false, "hint": "Run `toby connect myintegration` after configuring credentials." }
```

Reference: [`apps/plugin-azuread/`](../apps/plugin-azuread/), [`apps/plugin-gmail/`](../apps/plugin-gmail/), and
[`apps/plugin-jira/`](../apps/plugin-jira/) (Swift). See
[Migrating a built-in to a plugin](create-integration.md#migrating-a-built-in-to-a-plugin).

### Plugin setup

Plugins that need **one-time setup** (for example installing bundled macOS
Shortcuts that require user confirmation in Shortcuts.app) can advertise and
implement an optional `setup` subcommand.

**Advertise on `status`:**

```json
"setupAvailable": true,
"setupDescription": "Install bundled Focus shortcuts for Toby"
```

Omit both fields when the plugin has no setup flow.

**`setup` subcommand** — stdin: optional config envelope. stdout:

```json
{
  "ok": true,
  "actions": [
    {
      "id": "shortcut:toby-focus-on",
      "label": "Install Toby Focus On shortcut",
      "ok": true,
      "skipped": true,
      "detail": "Shortcut already installed."
    },
    {
      "id": "shortcut:toby-focus-off",
      "label": "Install Toby Focus Off shortcut",
      "ok": true,
      "detail": "Opened Shortcuts import — tap Add Shortcut to finish."
    }
  ]
}
```

Per-action fields:

| Field | Required | Meaning |
| ----- | -------- | ------- |
| `id` | yes | Stable machine id for the setup step |
| `label` | yes | Human-readable step name |
| `ok` | yes | Step succeeded (including already satisfied when `skipped: true`) |
| `skipped` | no | Step not attempted because prerequisites are already met |
| `detail` | no | Explanation, especially for user-intervention steps |

Top-level `ok` is `true` when the setup command ran. Use `ok: false` only for
fatal errors (unsupported platform, missing bundled assets). Partial per-action
failures use `ok: false` on individual actions while top-level `ok` stays
`true`.

**Idempotency:** plugin-owned. Toby does not persist setup completion; plugins
detect whether setup is already satisfied (for example by checking
`shortcuts list` on macOS).

Reference: [`apps/plugin-macos/`](../apps/plugin-macos/) (bundled Shortcuts).

## Protocol versioning

`protocolVersion` must be `"1"` for this spec. Toby rejects plugins reporting
an unsupported protocol version.

## Reference implementation

See the [reference implementations](#reference-implementations) table above.
Release archives include the sample plugin plus first-party integrations
(`toby-plugin-azuread`, `toby-plugin-gmail`, `toby-plugin-todoist`, `toby-plugin-jira`, `toby-plugin-applecalendar`);
`install-toby.sh` and `toby upgrade` install them into `~/.toby/plugins/`.

## Installing plugins

### Recommended: `toby plugins install`

```bash
toby plugins install /path/to/toby-plugin-myintegration
toby plugins install ./dist/toby-plugin-sample
toby plugins doctor
toby connect myintegration
```

The install command:

1. Resolves a plugin binary path (file or directory containing exactly one `toby-plugin-*` executable)
2. Validates naming, `status`, protocol version, and `tools list` (same bar as `toby plugins doctor`)
3. Rejects names that collide with built-in integrations
4. Copies the binary into `~/.toby/plugins/` (or `$TOBY_DIR/plugins/`)
5. If `status.setupAvailable` is true, prompts to run setup (interactive TTY only)

Flags:

- `--force` — overwrite an existing managed install
- `--link` — symlink instead of copy (useful while developing a plugin locally)
- `--setup` — run setup after install without prompting (requires a TTY when setup needs user interaction)
- `--no-setup` — skip the setup prompt and do not run setup

Non-interactive installs skip setup unless `--setup` is passed; passing
`--setup` without a TTY fails because setup may require GUI confirmation.

Re-run setup anytime:

```bash
toby plugins setup macos
```

To remove a managed install:

```bash
toby plugins uninstall myintegration
```

`uninstall` removes the binary from `~/.toby/plugins/` and purges stored plugin
data: credentials, connection state, disabled entries, default-provider
references, chat-inbound references, and cached tool results for that plugin.

### Manual alternative

You can copy a built binary directly into `~/.toby/plugins/` without using the
install command. Run `toby plugins list` to confirm discovery.

## Authoring checklist

1. Name the binary `toby-plugin-<name>`.
2. Implement all subcommands with JSON stdout and stable exit codes.
3. Accept config via stdin; do not read `~/.toby/` directly.
4. Declare at least one chat tool via `tools list`.
5. Honor `dryRun` in `tools execute` for mutating tools.
6. Return `appliedActions` strings for side effects.
7. Install with `toby plugins install <path>`, or copy the binary into `~/.toby/plugins/`.
8. Optional: implement `setup` and set `status.setupAvailable` when one-time setup is needed.
