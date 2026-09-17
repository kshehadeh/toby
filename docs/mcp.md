# MCP connections

Toby can attach any [Model Context Protocol](https://modelcontextprotocol.io)
server as a **connection**. MCP is a protocol, not a product plugin: N servers
can be live at once, each with its own transport, credentials, and tools.

Plugin integrations (Slack, Jira, …) remain **singleton** connections whose id
equals the plugin name. MCP is the first type with unbounded instances.

## Identity

| Concept | Key | Example |
| ------- | --- | ------- |
| Connection type | `slack`, `mcp`, … | Plugin package or the built-in MCP type |
| Connection instance | `config.connections[id]` | `slack`, `mcp_github`, `mcp_linear` |

- Singleton plugins: `id === type` (dual-written to `config.integrations[name]`).
- MCP servers: `id` is `mcp_<slug>` from the display name.

Secrets for MCP live only under `credentials.connections[id]` (never
`config.json`). Plugin secrets dual-write `credentials.integrations[name]` and
`credentials.connections[name]` during the migration window.

Implementation: [`packages/core/src/integrations/connections.ts`](../packages/core/src/integrations/connections.ts),
[`packages/core/src/integrations/mcp/`](../packages/core/src/integrations/mcp/).

## Transports and auth

| Transport | When | Auth |
| --------- | ---- | ---- |
| **stdio** | Local process (`command`, `args`, `cwd`) | None, or environment variables. **Not** OAuth. |
| **http** | Streamable HTTP URL | None, bearer / headers, or OAuth 2.1 (PKCE, resource metadata, optional dynamic client registration). |
| **sse** | Legacy HTTP+SSE servers | Same as HTTP. |

OAuth redirect URI: `http://127.0.0.1:9879/mcp/callback`. Authorization-server
hosts must match the resource host, loopback, or a small allowlist.

stdio is arbitrary command execution — only connect commands you trust.

## Tools

Discovered MCP tools are registered on the chat tool bundle with a prefix:

`mcp_<slug>_<originalName>` (non-alphanumerics become `_`).

An optional per-connection **tool allowlist** limits which original names are
exposed. MCP is chat-tools-only in v1 (no inbound, dashboard `standardTool`, or
provider category).

## Surfaces

**Toby.app → Settings → Integrations**

- Plugin rows are unchanged.
- Each MCP server is its own row.
- **Add MCP server** opens a wizard (name, transport, auth, connect).
- **Remove** deletes that MCP connection.

**CLI**

```
toby connections list
toby connections add --name GitHub --transport http --url https://api.githubcopilot.com/mcp/ --auth headers --bearer "$TOKEN"
toby connections add --name Filesystem --transport stdio --command npx --args '["-y","@modelcontextprotocol/server-filesystem","/tmp"]'
toby connections remove mcp_github
toby connect mcp_github
toby disconnect mcp_github
```

`toby connect slack` still connects the singleton Slack plugin.

**HTTP** (daemon)

| Method | Path |
| ------ | ---- |
| `GET` | `/api/connections` |
| `POST` | `/api/connections` |
| `GET` | `/api/connections/:id` |
| `DELETE` | `/api/connections/:id` |
| `POST` | `/api/connections/:id/connect` |
| `POST` | `/api/connections/:id/disconnect` |

`/api/integrations/:name/*` remains an alias when `name` is a connection id
(including `mcp_*`).

The daemon reconnects MCP servers that have `connectedAt` on startup and closes
stdio/HTTP sessions on stop.

## Client

Toby uses `@ai-sdk/mcp` (`createMCPClient`) so tools are already AI SDK `Tool`
objects. stdio uses `Experimental_StdioMCPTransport`. The process/session is
owned by the daemon, not spawned per tool call.
