# toby-plugin-websearch

Swift installable plugin for Toby web search (Brave Search API).

## Build

From repo root:

```bash
bun run build:plugin:websearch
```

Or directly:

```bash
swift build -c release --package-path apps/plugin-websearch
```

Output: `dist/toby-plugin-websearch` (via root script) or `.build/release/toby-plugin-websearch`.

## Install (dev)

```bash
toby plugins install ./dist/toby-plugin-websearch --link --force
toby plugins doctor
toby plugins inspect websearch
```

## Configure

1. Get a [Brave Search API](https://brave.com/search/api/) key.
2. Run `toby configure` → **Web Search** → enter API key.
3. Run `toby connect websearch`.

The `webSearch` tool is available globally in every chat session when configured.
