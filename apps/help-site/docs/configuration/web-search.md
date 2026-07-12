---
sidebar_position: 2
title: Web Search
---

# Web Search

Web Search is a **built-in** chat capability—not an installable integration. When enabled, the `webSearch` tool is available in **every** chat session automatically. You do not select it in the integration picker.

Search runs through **Perplexity** via the **Vercel AI Gateway**.

## How it works

When the model calls `webSearch`, Toby makes a separate lightweight call to the Vercel AI Gateway (using a small gateway model with Perplexity search). Results include titles, URLs, snippets, and optional dates.

Because search uses its own gateway call—not your persona’s model turn—**web search works with any persona AI provider** (OpenAI, Ollama, or Vercel AI Gateway). Your chat model does not need to be the gateway.

No separate web-search API key is required. Toby reuses your **Vercel AI Gateway** API key.

## Prerequisites

- A **Vercel AI Gateway API key** configured under **Settings → AI → Vercel AI Gateway**  
  See [Vercel AI Gateway](../ai-providers/vercel-ai-gateway).

## Configure

1. Open **Toby.app → Settings → AI → Vercel AI Gateway** and enter your API key.
2. Open **Settings → Web Search**.
3. Set **Enabled** to **On**.
4. Leave **Provider** as the default (AI Gateway / Perplexity) unless Toby offers additional providers later.

| Setting | Purpose |
| ------- | ------- |
| **Provider** | Search backend (currently AI Gateway) |
| **Enabled** | Master switch for the global `webSearch` tool |

## Using web search in chat

Once enabled (and the gateway key is present), `webSearch` is a **global tool** in all sessions. Ask Toby to look things up or research current information.

### Example prompts

- “Search the web for the latest news on AI regulation”
- “Research the best restaurants in Tokyo near Shibuya station”
- “Find recent articles about the Rust programming language”

For structured forecasts, enable [Weather](./weather) and ask about the weather for a place—Toby uses `getWeather` instead of web search when that tool is available.

### Combined with web fetch

`fetchWebContent` is always available and does not require Web Search settings. You can combine both:

1. Search: *“Search for recent articles about TypeScript 5.5”*
2. Read: *“Read the content from the first result”*

Toby uses `webSearch` for results, then `fetchWebContent` to extract clean article text from a URL.

## Related

- [Configuration overview](./overview)
- [Vercel AI Gateway](../ai-providers/vercel-ai-gateway)
- [Integrations overview](../integrations/overview) — web tools vs installable plugins
- Developer notes: [web-search.md](https://github.com/kshehadeh/toby/blob/main/docs/web-search.md)
