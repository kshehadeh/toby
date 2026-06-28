---
sidebar_position: 4
title: Web Search
---

# Web Search

Search the web from chat using **Perplexity** through the **Vercel AI Gateway**. When enabled, the `webSearch` tool is available in **every** chat session automatically — you don't need to select an integration explicitly.

## How it works

Web search uses the AI Gateway's built-in Perplexity search tool. The gateway executes the search server-side during model generation and returns titles, URLs, snippets, and optional dates. No separate API key is needed — web search reuses your existing Vercel AI Gateway API key.

**Important:** Web search is only active when your persona's **AI Provider** is set to **Vercel AI Gateway** (model slug like `openai/gpt-4.1-mini`). When using OpenAI or Ollama directly, the gateway cannot execute the search tool.

## Prerequisites

- A **Vercel AI Gateway API key** (see [AI settings](../getting-started/configure-and-status))
- Persona AI provider set to **Vercel AI Gateway**

## Configure

1. Open **Settings → AI → Vercel AI Gateway** and enter your API key.
2. Set your persona's **AI Provider** to **Vercel AI Gateway**.
3. Open **Settings → Web Search** and set **Enabled** to **On**.

No separate web search API key is required.

## Using web search in chat

Once enabled, `webSearch` is available in all chat sessions as a global tool. The model can search the web and cite source URLs from the results.

### Example chat prompts

- "Search the web for the latest news on AI regulation"
- "Look up the weather forecast for San Francisco this weekend"
- "Research the best restaurants in Tokyo near Shibuya station"
- "Find recent articles about Rust programming language"

### Combined with web fetch

You can combine `webSearch` with `fetchWebContent` (always available) to read full articles:

1. Ask Toby to search for something: *"Search for recent articles about TypeScript 5.5"*
2. Then ask it to read a result: *"Read the content from the first result"*

Toby will use `webSearch` to find results, then `fetchWebContent` to extract the clean article text from a chosen URL — stripping ads, navigation, and footers.

## Related

- [Integrations overview](overview)
- [Configure and connect](../getting-started/configure-and-status)
- Developer notes: [`docs/web-search.md`](https://github.com/kshehadeh/toby/blob/main/docs/web-search.md) in the Toby repository
