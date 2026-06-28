# Web Search

Built-in web search via the **Vercel AI Gateway's Perplexity search**. No plugin required.

## How it works

`webSearch` is a **client-side function tool**. When the model calls it, the tool's `execute` makes a separate lightweight `generateText` call to the Vercel AI Gateway using `openai/gpt-4.1-mini` with `gateway.tools.perplexitySearch()` (a provider-executed tool that the gateway runs server-side). The gateway sends the search query to Perplexity and returns titles, URLs, snippets, and optional dates, which the tool returns to the calling model.

Because the search runs in a dedicated gateway call (not in the persona's own model turn), **web search works with any persona AI provider** — OpenAI, Ollama, or the Vercel AI Gateway. The persona's AI provider does not need to be the gateway.

## Setup

1. Configure a **Vercel AI Gateway API key** under **Settings → AI → Vercel AI Gateway**.
2. Enable **Settings → Web Search → Enabled**.

No separate API key is needed — web search reuses the existing Vercel AI Gateway key. The persona's AI provider can be anything.

## Configuration

| Setting | Key | Description |
| ------- | --- | ----------- |
| Provider | `webSearch.provider` | Search provider (currently `ai-gateway` only). |
| Enabled | `webSearch.enabled` | Toggle web search on/off. |

## Chat tool

| Tool | Purpose |
| ---- | ------- |
| `webSearch` | Search the web via Perplexity through the AI Gateway. Returns titles, URLs, snippets, and optional dates. The model generates inputs matching the Perplexity search schema (`query`, `max_results`, `search_recency_filter`, `country`, etc.). |

`webSearch` is a **conditional global tool**: when enabled (and a Vercel AI Gateway API key is present), it is available in every chat session regardless of the persona's AI provider. Global wiring lives in [`packages/core/src/ai/web-search-global-tools.ts`](../packages/core/src/ai/web-search-global-tools.ts).

Combine with the always-available **`fetchWebContent`** tool to read full articles from result URLs.

## Architecture

| Layer | Location |
| ----- | -------- |
| Provider registry | [`packages/core/src/ai/web-search-providers.ts`](../packages/core/src/ai/web-search-providers.ts) |
| Global `webSearch` tool (client-side function tool) | [`packages/core/src/ai/web-search-global-tools.ts`](../packages/core/src/ai/web-search-global-tools.ts) |
| Config schema (`WebSearchConfig`) | [`packages/core/src/config/index.ts`](../packages/core/src/config/index.ts) |
| Configure tree (Web Search section) | [`packages/core/src/configure/tree.ts`](../packages/core/src/configure/tree.ts) |
| Configure persistence | [`packages/core/src/configure/persistence.ts`](../packages/core/src/configure/persistence.ts) |
