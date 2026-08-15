# toby-plugin-news

Installable integration plugin for **latest news** and article search from
[Hacker News](https://hn.algolia.com/api) (no key) and
[The Guardian Open Platform](https://open-platform.theguardian.com/) (optional
free key). Implements [plugin protocol v1](../../docs/plugin-protocol.md) as a
TypeScript bun-package.

The plugin never reads `~/.toby/` and does not ship a shared Guardian key.

## Development

```bash
bun run build:plugin:news
toby plugins install ./dist/toby-plugin-news --link --force
toby connect news          # Hacker News works immediately
toby configure             # optional: set news.apiKey for The Guardian
```

Or install sources directly:

```bash
toby plugins install ./apps/plugin-news --link --force
```

## Tools

| Tool | Purpose |
| ---- | ------- |
| `getLatestNews` | Latest headlines (`source`: `all`, `hacker-news`, `guardian`) |
| `searchNews` | Search recent articles by topic on the same sources |

## Layout

```text
apps/plugin-news/
  manifest.json
  package.json
  README.md
  src/
    index.ts      # protocol v1 entry
    protocol.ts
    client.ts         # source dispatch
    guardian.ts       # Guardian Content API
    hacker-news.ts    # Algolia HN Search API
    tools.ts
    prompts.ts
  tests/
```
