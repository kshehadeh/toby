# toby-plugin-sample

Reference installable integration plugin for [Toby](../../README.md). Implements
[plugin protocol v1](../../docs/plugin-protocol.md).

## Commands

```bash
# From repo root
bun run build:plugin:sample

# Or from this directory
bun run build
```

Output: `dist/toby-plugin-sample`. Install into Toby with
`toby plugins install ./dist/toby-plugin-sample`.

## Try it

```bash
bun run build:plugin:sample
toby plugins install ./dist/toby-plugin-sample
toby plugins doctor
toby configure   # set sample.apiKey
toby connect sample
toby status --integration sample
```

During local development you can symlink instead of copying:

```bash
toby plugins install ./dist/toby-plugin-sample --link --force
```

## Tools

- `sampleEcho` — read-only echo with configurable greeting prefix
- `sampleMutate` — mutating demo tool honoring `dryRun`
