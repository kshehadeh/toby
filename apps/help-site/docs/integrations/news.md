---
sidebar_position: 12
title: News
---

# <span class="docs-brand-title"><span class="docs-brand-icon-emoji" aria-hidden="true">📰</span>News</span>

Connect Toby to **The Guardian Open Platform** to fetch latest headlines and search recent articles from chat.

The News plugin ships with Toby.app under `~/.toby/plugins/`.

## Prerequisites

- A free [Guardian Open Platform](https://open-platform.theguardian.com/access/) API key (no credit card)

## Get your API key

1. Open [The Guardian Open Platform access page](https://open-platform.theguardian.com/access/).
2. Register for a developer key and copy it.
3. Keep the key private — it is tied to your registration.

The developer tier is free for personal use.

## Configure

Open **Toby.app → Integrations → News** and enter:

| Field | Description |
| ----- | ----------- |
| Guardian API key | Your Open Platform key |
| Default section | Optional desk for headline requests that do not specify a section (`all`, `world`, `us-news`, `technology`, …) |

Save the configuration.

You can also use the **Setup Guide** button on the News detail page.

## Connect

Click **Connect** on the News detail page. Toby validates the key against The Guardian search API and marks News as connected.

## Verify

Return to **Integrations** in the sidebar. News should show as connected and healthy.

## Disconnect

Open the News detail page and click **Disconnect**. This clears Toby's connection flag. Remove the API key in configure if you want it gone from stored credentials.

## What you can do in chat

| Capability | Examples |
| ---------- | -------- |
| Latest headlines | “What's in the news today?” / “Give me the latest technology headlines.” |
| Topic search | “What has The Guardian written about interest rates this week?” |

Stories are attributed to **The Guardian**. Toby returns headlines, short summaries, dates, and article URLs — not the full article body.

## Example chat prompts

- “What are the top world headlines?”
- “Search news about the Fed and inflation.”
- “Any recent science stories I should know about?”

## Tips

- Use a section (`world`, `us-news`, `uk-news`, `technology`, `business`, `sport`, `science`, `environment`, `culture`, `politics`) when you want a desk, not the whole site.
- For a specific subject, ask Toby to **search** rather than only fetch latest headlines.
- If Connect fails, re-copy the key from the Open Platform dashboard and try again.

## Related

- [Integrations overview](overview)
- [Configure and connect](../getting-started/configure-and-status)
- [Creating a plugin](../plugins/creating-a-plugin)
