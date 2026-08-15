# toby-plugin-news

Installable integration plugin for **latest news** and article search via
[The Guardian Open Platform](https://open-platform.theguardian.com/). Implements
[plugin protocol v1](../../docs/plugin-protocol.md) as a TypeScript bun-package.

The developer tier is free for personal use. Users register for their own API
key — the plugin never reads `~/.toby/` and does not ship a shared key.

## Development

```bash
bun run build:plugin:news
toby plugins install ./dist/toby-plugin-news --link --force
toby configure   # set news.apiKey
toby connect news
```

Or install sources directly:

```bash
toby plugins install ./apps/plugin-news --link --force
```

## Tools

| Tool | Purpose |
| ---- | ------- |
| `getLatestNews` | Latest Guardian headlines, optional section / date / limit |
| `searchNews` | Search recent Guardian articles by topic |

## Layout

```text
apps/plugin-news/
  manifest.json
  package.json
  README.md
  src/
    index.ts      # protocol v1 entry
    protocol.ts
    client.ts     # Guardian Content API
    tools.ts
    prompts.ts
  tests/
```
