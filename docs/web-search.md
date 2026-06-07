# Web Search integration

First-party integration id: **`websearch`**, shipped as the Swift installable plugin **`toby-plugin-websearch`** ([`apps/plugin-websearch/`](../apps/plugin-websearch/)). Release archives and `install-toby.sh` install it under `~/.toby/plugins/`.

## Backend

Web search uses the [Brave Search API](https://brave.com/search/api/). Toby sends your API key as the `X-Subscription-Token` header. The integration is named **Web Search** in the UI; Brave is the search provider, not the integration name.

## Setup

1. Get a Brave Search API key from the [Brave Search API dashboard](https://api.search.brave.com/app/dashboard).
2. Run **`toby configure`** → **Integrations → Web Search** → enter **Brave Search API Key**.
3. Run **`toby connect websearch`** to validate the key and mark the integration connected.

From source:

```bash
bun run build:plugin:websearch
toby plugins install ./dist/toby-plugin-websearch --link --force
toby plugins doctor
```

## Chat tool

| Tool | Purpose |
| ---- | ------- |
| `webSearch` | Search the web. Returns titles, URLs, descriptions, and optional page age. Supports `count` (1–20) and `freshness` (`pd`, `pw`, `pm`, `py`). |

`webSearch` is a **conditional global tool**: when the plugin is installed and an API key is configured, it is available in **every** chat session without selecting `--integration websearch`. Global wiring lives in [`packages/core/src/ai/web-search-global-tools.ts`](../packages/core/src/ai/web-search-global-tools.ts).

Combine with the always-available **`fetchWebContent`** tool to read full articles from result URLs.

## Provider category

`websearch` declares `providerCategories: ["search"]`. Use **`toby configure`** to set a default search provider when multiple search integrations exist.

## Migration from `bravesearch`

The built-in `bravesearch` integration was removed in favor of this plugin. On startup, Toby migrates:

- `credentials.integrations.bravesearch` → `credentials.integrations.websearch`
- `config.integrations.bravesearch` connected state → `config.integrations.websearch`

CLI commands are now `toby connect websearch`, `toby status integration -i websearch`, and `toby disconnect websearch`.

## Architecture

| Layer | Location |
| ----- | -------- |
| Swift plugin (API client, tools, protocol) | [`apps/plugin-websearch/`](../apps/plugin-websearch/) |
| Plugin adapter (discovery, configure, chat) | [`packages/core/src/integrations/plugins/`](../packages/core/src/integrations/plugins/) |
| Global `webSearch` tool bridge | [`packages/core/src/ai/web-search-global-tools.ts`](../packages/core/src/ai/web-search-global-tools.ts) |
| Legacy credential migration | [`packages/core/src/integrations/plugins/migrate.ts`](../packages/core/src/integrations/plugins/migrate.ts) |

User-facing setup: [help-site Web Search](../apps/help-site/docs/integrations/web-search.md).
