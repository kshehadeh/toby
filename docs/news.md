# News

First-party integration id: **`news`**, shipped as the TypeScript bun-package
plugin **`toby-plugin-news`** ([`apps/plugin-news/`](../apps/plugin-news/)).
Release archives and `install-toby.sh` install it under `~/.toby/plugins/`.

The plugin reads **The Guardian Open Platform** Content API
(`https://content.guardianapis.com`). The developer tier is free for personal
use. Each user registers for their own API key — the plugin does not ship a
shared key and must not read `~/.toby/` itself.

## Setup

1. Get a free key at [The Guardian Open Platform](https://open-platform.theguardian.com/access/).
2. Open **Toby.app → Integrations → News** (or `toby configure`) and enter the
   key. Optionally pick a default section (`world`, `technology`, …, or `all`).
3. Run **`toby connect news`**. Toby calls `/search?page-size=1` to validate the
   key.

Toby.app also exposes this flow as an Integration Setup Guide (`setup guide`).

## Tools

| Tool | Purpose |
| ---- | ------- |
| `getLatestNews` | Latest headlines. Optional `section`, `limit` (default 8, max 20), `fromDate` (`YYYY-MM-DD`). |
| `searchNews` | Search recent articles. Required `query`; optional `section`, `limit`, `fromDate`. |

Both tools are read-only. Results include title, section, publication time,
summary (`trailText` with HTML stripped), byline, thumbnail, and canonical URL.
Every result set is attributed as `source: "The Guardian"`.

## Configuration

Field keys are local to the plugin (Toby namespaces them as `news.<key>`):

| Field | Required | Description |
| ----- | -------- | ----------- |
| `apiKey` | yes (masked) | Guardian Open Platform API key |
| `defaultSection` | no | `all` (default) or a Guardian section id such as `world`, `us-news`, `uk-news`, `technology`, `business`, `sport`, `science`, `environment`, `culture`, `politics`, `lifeandstyle` |

`toby disconnect news` clears the connected flag. The stored API key remains
until the user removes it in configure.

## Tests and local override

Unit tests mock `fetch`. Protocol tests can point the client at a local mock
with `TOBY_NEWS_API_BASE` (no trailing path). Production default is
`https://content.guardianapis.com`.
