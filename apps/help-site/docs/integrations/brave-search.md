---
sidebar_position: 4
title: Brave Search
---

# Brave Search

Connect Toby to Brave Search to search the web from chat. When configured, the `webSearch` tool is available in **every** chat session automatically—you don't need to select the integration explicitly.

**CLI name:** `bravesearch`

## Prerequisites

- A [Brave Search](https://brave.com/search/api/) account
- A **Brave Search API key** (see below)

## Get your API key

Brave Search offers a free tier (up to 2,000 queries/month) and paid plans for higher volume.

### 1. Sign up for Brave Search API

1. Go to [Brave Search API](https://brave.com/search/api/).
2. Click **Get Started** and create an account.
3. Choose a plan (Free is sufficient for personal use).

### 2. Copy your API key

1. Open the [Brave Search API dashboard](https://api.search.brave.com/app/dashboard).
2. Under **API Keys**, copy your subscription token.

Toby sends this token as the `X-Subscription-Token` header on each request.

## Configure

```bash
toby config
```

Go to **Integrations → Brave Search** and enter:

| Field | Description |
| ----- | ----------- |
| API Key | Your Brave Search API subscription token |

Save the configuration.

## Connect

```bash
toby connect bravesearch
```

Toby validates the API key and marks Brave Search as connected.

## Verify

```bash
toby status integration -i bravesearch
```

## Disconnect

```bash
toby disconnect bravesearch
```

## Using web search in chat

Once the API key is configured, `webSearch` is available in all chat sessions as a global tool. You don't need to specify `--integration bravesearch`—Toby includes it automatically when the API key is present.

### Example chat prompts

- "Search the web for the latest news on AI regulation"
- "Look up the weather forecast for San Francisco this weekend"
- "Research the best restaurants in Tokyo near Shibuya station"
- "Find recent articles about Rust programming language"

### Combined with web fetch

You can combine `webSearch` with `fetchWebContent` (always available) to read full articles:

1. Ask Toby to search for something: *"Search for recent articles about TypeScript 5.5"*
2. Then ask it to read a result: *"Read the content from the first result"*

Toby will use `webSearch` to find results, then `fetchWebContent` to extract the clean article text from a chosen URL—stripping ads, navigation, and footers.

## Search options

The `webSearch` tool supports optional parameters that Toby can use automatically based on your request:

| Parameter | Values | Description |
| --------- | ------ | ----------- |
| `count` | 1–20 | Number of results to return (default 10) |
| `freshness` | `pd`, `pw`, `pm`, `py` | Time filter: past day, past week, past month, past year |

For example, asking *"What happened in tech news today?"* will automatically use `freshness: pd` (past day).

## Related

- [Integrations overview](overview)
- [Configure and connect](../getting-started/configure-and-status)
