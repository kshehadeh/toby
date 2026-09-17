---
sidebar_position: 12
title: MCP servers
---

# MCP servers

Toby can connect to any [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server and use its tools in chat. Unlike Slack or Todoist, MCP is a protocol: you can add as many servers as you want.

## Add a server

1. Open **Settings → Integrations**.
2. Click **Add MCP server**.
3. Give it a display name.
4. Choose a transport:
   - **Local command (stdio)** — runs a command on this Mac (`npx`, a binary, …)
   - **Streamable HTTP** — a remote MCP URL
   - **Legacy SSE** — older HTTP+SSE servers
5. Choose authentication:
   - None
   - Environment variables (stdio)
   - Bearer token or custom HTTP headers
   - OAuth 2.1 (HTTP/SSE; Toby opens a browser)
6. Save. Toby connects and loads the server’s tools into chat.

Each MCP server appears as its own row in Integrations. **Disconnect** stops it but keeps the configuration. **Remove** deletes it.

## Tools in chat

MCP tools show up in chat with a prefix so two servers can both expose `search` without colliding. For a server named GitHub, a tool called `search` is registered as `mcp_github_search`.

You can optionally allow only some original tool names on the server’s detail page (**Tool allowlist**).

## Security

- A **stdio** connection runs a local command. Only use commands you trust.
- Secrets (tokens, env JSON, headers) are stored in encrypted credentials, not in `config.json`.
- OAuth uses `http://127.0.0.1:9879/mcp/callback`. Register that redirect URI if the provider asks for one.

## CLI

```sh
toby connections list
toby connections add --name GitHub --transport http --url https://example.com/mcp --auth headers --bearer "$TOKEN"
toby connections add --name Files --transport stdio --command npx --args '["-y","@modelcontextprotocol/server-filesystem"]'
toby connections remove mcp_github
```
