# toby-plugin-sample-ts

Reference installable **TypeScript (bun-package)** integration plugin for
[Toby](../../README.md). Implements [plugin protocol v1](../../docs/plugin-protocol.md).

Unlike [`toby-plugin-sample`](../plugin-sample), this plugin is not compiled
with `bun build --compile`. Toby discovers the directory, reads `manifest.json`,
and invokes `src/index.ts` via the bundled Bun runtime.

**Protocol docs:** [`docs/plugin-protocol.md#typescript-package-plugins-bun-package`](../../docs/plugin-protocol.md#typescript-package-plugins-bun-package)

## Install

```bash
# From repo root — install the directory directly (no build step needed)
toby plugins install ./apps/plugin-sample-ts

# Or symlink for local development
toby plugins install ./apps/plugin-sample-ts --link --force
```

## Try it

```bash
toby plugins install ./apps/plugin-sample-ts
toby plugins doctor
toby plugins inspect sample-ts
toby configure   # set sample-ts.apiKey
toby connect sample-ts
toby status --integration sample-ts
```

## Tools

- `sampleTsEcho` — read-only echo with configurable greeting prefix
- `sampleTsMutate` — mutating demo tool honoring `dryRun`

## Layout

```text
apps/plugin-sample-ts/
  manifest.json     # plugin metadata (name, version, runtime entry)
  package.json      # workspace package (no build compilation needed)
  src/index.ts      # protocol v1 entry point
```
