# News

First-party integration id: **`news`**, shipped as the TypeScript bun-package
plugin **`toby-plugin-news`** ([`apps/plugin-news/`](../apps/plugin-news/)).
Release archives and `install-toby.sh` install it under `~/.toby/plugins/`.

The plugin reads two free APIs:

| Source | API | Auth |
| ------ | --- | ---- |
| **Hacker News** | [Algolia HN Search](https://hn.algolia.com/api) (`https://hn.algolia.com/api/v1`) | None |
| **The Guardian** | [Open Platform](https://open-platform.theguardian.com/) (`https://content.guardianapis.com`) | Optional personal API key |

The plugin does not ship a shared Guardian key and must not read `~/.toby/`
itself.

## Setup

1. Run **`toby connect news`**. Hacker News is checked immediately; no key is
   required.
2. Optional: get a free Guardian key at
   [The Guardian Open Platform](https://open-platform.theguardian.com/access/)
   and enter it in **Toby.app → Integrations → News** (or `toby configure`).
   Re-connect so Toby validates the key.

Toby.app also exposes this flow as an Integration Setup Guide (`setup guide`).

## Tools

| Tool | Purpose |
| ---- | ------- |
| `getLatestNews` | Latest headlines. Optional `source` (`all`, `hacker-news`, `guardian`), `section`, `limit` (default 8, max 20 per source), `fromDate` (`YYYY-MM-DD`). |
| `searchNews` | Search recent articles. Required `query`; same optional `source` / `section` / `limit` / `fromDate`. |

`section` is source-specific:

- Guardian: `world`, `us-news`, `uk-news`, `technology`, `business`, `sport`,
  `science`, `environment`, `culture`, `politics`, …
- Hacker News: `front_page` (default for latest), `newest`, `ask_hn`, `show_hn`

Both tools are read-only. Each article includes `source` (`Hacker News` or
`The Guardian`), title, section, publication time, summary, URL, and optional
byline / thumbnail / HN score and comment count.

When `source` is `all` and no Guardian key is configured, Guardian is skipped
with a warning and Hacker News results are still returned.

## Configuration

Field keys are local to the plugin (Toby namespaces them as `news.<key>`):

| Field | Required | Description |
| ----- | -------- | ----------- |
| `defaultSource` | no | `all` (default), `hacker-news`, or `guardian` |
| `apiKey` | no (masked) | Guardian Open Platform API key — needed only for Guardian |
| `defaultSection` | no | Guardian desk when a Guardian request omits `section` |

`toby disconnect news` clears the connected flag. The stored API key remains
until the user removes it in configure.

## Tests and local override

Unit tests mock `fetch`. Protocol tests can point the clients at local mocks:

| Env | Default |
| --- | ------- |
| `TOBY_NEWS_API_BASE` | `https://content.guardianapis.com` |
| `TOBY_HN_API_BASE` | `https://hn.algolia.com/api/v1` |
