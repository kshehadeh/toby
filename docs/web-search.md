# Web Search

Built-in web search via the **Vercel AI Gateway's Perplexity search**. No plugin required.

## How it works

Web search uses `gateway.tools.perplexitySearch()` from the AI SDK — a provider-executed tool that the Vercel AI Gateway runs server-side during model generation. The gateway sends the search query to Perplexity and returns titles, URLs, snippets, and optional dates.

Because the tool is provider-executed, **web search is only active when the persona's AI provider is set to Vercel AI Gateway**. When the persona uses OpenAI or Ollama directly, the gateway cannot execute the tool and web search is unavailable.

## Setup

1. Configure a **Vercel AI Gateway API key** under **Settings → AI → Vercel AI Gateway**.
2. Set the persona's **AI Provider** to **Vercel AI Gateway** (model slug like `openai/gpt-4.1-mini`).
3. Enable **Settings → Web Search → Enabled**.

No separate API key is needed — web search reuses the existing Vercel AI Gateway key.

## Configuration

| Setting | Key | Description |
| ------- | --- | ----------- |
| Provider | `webSearch.provider` | Search provider (currently `ai-gateway` only). |
| Enabled | `webSearch.enabled` | Toggle web search on/off. |

## Chat tool

| Tool | Purpose |
| ---- | ------- |
| `webSearch` | Search the web via Perplexity through the AI Gateway. Returns titles, URLs, snippets, and optional dates. The model generates inputs matching the Perplexity search schema (`query`, `max_results`, `search_recency_filter`, `country`, etc.). |

`webSearch` is a **conditional global tool**: when enabled and the persona uses the Vercel AI Gateway, it is available in every chat session. Global wiring lives in [`packages/core/src/ai/web-search-global-tools.ts`](../packages/core/src/ai/web-search-global-tools.ts).

Combine with the always-available **`fetchWebContent`** tool to read full articles from result URLs.

## Architecture

| Layer | Location |
| ----- | -------- |
| Provider registry | [`packages/core/src/ai/web-search-providers.ts`](../packages/core/src/ai/web-search-providers.ts) |
| Global `webSearch` tool (gateway provider tool) | [`packages/core/src/ai/web-search-global-tools.ts`](../packages/core/src/ai/web-search-global-tools.ts) |
| Config schema (`WebSearchConfig`) | [`packages/core/src/config/index.ts`](../packages/core/src/config/index.ts) |
| Configure tree (Web Search section) | [`packages/core/src/configure/tree.ts`](../packages/core/src/configure/tree.ts) |
| Configure persistence | [`packages/core/src/configure/persistence.ts`](../packages/core/src/configure/persistence.ts) |
