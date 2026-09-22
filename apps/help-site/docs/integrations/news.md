---
sidebar_position: 12
title: News
---

# <span class="docs-brand-title"><span class="docs-brand-icon-emoji" aria-hidden="true">📰</span>News</span>

Connect Toby to **Hacker News** and, optionally, **The Guardian** to fetch latest headlines and search recent articles from chat.

The News plugin ships with Toby.app under `~/.toby/plugins/`.

## Prerequisites

- None for Hacker News
- Optional: a free [Guardian Open Platform](https://open-platform.theguardian.com/access/) API key for world news (no credit card)

## Configure

Open **Toby.app → Settings → Integrations → News** and click **Setup Guide**.
The wizard asks you to:

1. Choose a default source: Hacker News and The Guardian, Hacker News only, or The Guardian only.
2. Optionally paste a free [Guardian Open Platform](https://open-platform.theguardian.com/access/) key. Leave it blank to use Hacker News only. The Guardian only requires a key.
3. Connect. Toby checks Hacker News immediately, and The Guardian when a key is set.

The same wizard opens from the **News** card on Home when News is not connected (**Set up News**).

You can still edit the fields directly on the News detail page:

| Field | Description |
| ----- | ----------- |
| Default source | `all` (Hacker News plus Guardian when a key is set), `hacker-news`, or `guardian` |
| Guardian API key | Optional Open Platform key for The Guardian |
| Default Guardian section | Optional desk for Guardian requests that do not specify a section |

## Connect

**Setup Guide** connects for you. You can also click **Connect** on the News detail page. Toby checks Hacker News immediately. If you added a Guardian key, it validates that too.

## Verify

Return to **Settings → Integrations**. News should show as connected and healthy.

## Disconnect

Select News in **Settings → Integrations** and click **Disconnect**. This clears Toby's connection flag. Remove the API key in configure if you want it gone from stored credentials.

## What you can do in chat

| Capability | Examples |
| ---------- | -------- |
| Hacker News | “What's on the HN front page?” / “Any good Show HN posts today?” |
| World news | “What are the top world headlines?” (needs a Guardian key) |
| Topic search | “Search Hacker News for SQLite” / “What has The Guardian written about interest rates?” |

Each story is attributed to **Hacker News** or **The Guardian**. Toby returns headlines, short summaries, dates, and article URLs — not the full article body.

## Example chat prompts

- “What's on Hacker News right now?”
- “Search news about the Fed and inflation.”
- “Show me recent Ask HN posts.”
- “Any recent science stories I should know about?”

## Tips

- Ask for **Hacker News** explicitly when you want the front page, Show HN, or Ask HN.
- Guardian sections include `world`, `us-news`, `uk-news`, `technology`, `business`, `sport`, `science`, `environment`, `culture`, and `politics`.
- For a specific subject, ask Toby to **search** rather than only fetch latest headlines.
- If Guardian Connect fails, re-copy the key from the Open Platform dashboard. Hacker News still works without it.

## Related

- [Integrations overview](overview)
- [Configure and connect](../getting-started/configure-and-status)
- [Creating a plugin](../plugins/creating-a-plugin)
