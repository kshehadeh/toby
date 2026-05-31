# Toby plugin protocol (v1)

Installable plugins are standalone executables that implement a fixed subcommand
contract. Toby discovers them, invokes them as subprocesses, and adapts their
responses into the same `IntegrationModule` surface used by first-party
integrations.

Toby remains the **source of truth** for configuration and connection state.
Plugins receive the current config on each invocation and return JSON on stdout.

## Binary naming and discovery

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

## Invocation contract

Every subcommand writes **one JSON object** to stdout and uses these exit codes:

| Code | Meaning |
| ---- | ------- |
| `0` | Success (`ok: true`) |
| `1` | Business failure (`ok: false`) |
| `2` | Contract/usage error (invalid args, malformed plugin output) |

Human-readable diagnostics may go to stderr. stdout must contain only JSON.

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
`resources`.

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

## Protocol versioning

`protocolVersion` must be `"1"` for this spec. Toby rejects plugins reporting
an unsupported protocol version.

## Reference implementation

See [`helpers/toby-plugin-sample/`](../helpers/toby-plugin-sample/) for a
minimal plugin built independently. Release archives include the sample plugin;
`install-toby.sh` installs it into `~/.toby/plugins/`.

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

Flags:

- `--force` — overwrite an existing managed install
- `--link` — symlink instead of copy (useful while developing a plugin locally)

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
