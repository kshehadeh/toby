# Standalone executable (Bun)

You can ship Toby as a **single native binary** (Bun runtime + bundled app) using:

```bash
bun install
bun run build:executable
```

The output is **`dist/toby`** (on Windows, use `--outfile ./dist/toby.exe`).

## Requirements

- **[Bun](https://bun.sh)** installed locally (used only at build time; end users do not need Bun to *run* the binary).
- Dependencies installed so **`postinstall`** runs **`patch-package`** (see below).

## Why `patch-package` is used (Yoga + Ink)

### 1. `yoga-wasm-web` — WASM path inside `bun --compile`

Ink depends on **`yoga-wasm-web/auto`**, which on Node resolves to code that loads **`yoga.wasm`** from disk. **`bun build --compile`** bundles into a virtual filesystem where that relative path is not available (`Cannot find module './yoga.wasm'`).

We patch **`yoga-wasm-web@0.3.3`** to add **`dist/ink-default.js`**: it imports the **asm** build (pure JS, no WASM file), **calls its default export once** (that default is an initializer function, not the Yoga API object), and re-exports the initialized Yoga instance — the same shape Ink expects from `auto`. A **`./ink-default`** export is also added to `package.json` for completeness.

### 2. `ink` — point Yoga imports at the bridge

**`patches/ink+4.4.1.patch`** replaces `yoga-wasm-web/auto` with a **relative** import to **`../../yoga-wasm-web/dist/ink-default.js`** in Ink’s published `build/*.js` files. Bun’s bundler does not reliably resolve custom subpath exports on patched packages, but it does resolve this filesystem path the same way Node does.

Importing **`yoga-wasm-web/asm` directly in Ink is not enough**: that subpath’s default export is a **function** (`() => Yoga`). Ink does `Yoga.Node.create()` on the default import, so it must receive the **initialized** object. The bridge fixes that for both Node and the compiled binary.

### Upgrading dependencies

- **`ink`**: If a new version still imports `yoga-wasm-web/auto`, re-apply the import swap to `../../yoga-wasm-web/dist/ink-default.js` (from each `build/*.js` file), then `npx patch-package ink`.
- **`yoga-wasm-web`**: If the asm entry or package exports change, refresh **`patches/yoga-wasm-web+0.3.3.patch`** (re-add `dist/ink-default.js` and the `./ink-default` export if needed), then `npx patch-package yoga-wasm-web`.

## Cross-compilation

To build for another OS/arch from a machine that has Bun:

```bash
bun build ./src/cli.ts --compile --target=bun-linux-x64 --outfile ./dist/toby-linux
```

See [Bun’s executable docs](https://bun.sh/docs/bundler/executables) for `--target` values (`bun-darwin-arm64`, `bun-windows-x64`, etc.).

## npm / `tsup` workflow unchanged

`npm run build` still produces **`dist/cli.js`** via **tsup** for `npm link`, `npx`, or publishing the package. The Bun binary is an **optional** distribution path.

## GitHub Releases (CI)

Pushing a **version tag** matching `v*` runs [`.github/workflows/release.yml`](../.github/workflows/release.yml):

1. Matrix builds **four** standalone binaries: `toby-linux-x64`, `toby-linux-arm64`, `toby-darwin-arm64`, `toby-darwin-x64`.
2. Creates a **GitHub Release** for that tag and uploads those files as release assets (via `softprops/action-gh-release`).

Ensure **Actions** permissions allow the default `GITHUB_TOKEN` to create releases for tag pushes (Repository → Settings → Actions → General → Workflow permissions → read and write).

### Shipping a release with release-it

This repo uses **[release-it](https://github.com/release-it/release-it)** so you do not have to hand-cut tags:

| Script | Purpose |
| ------ | ------- |
| `npm run release` / `bun run release` | Interactive: choose **patch** / **minor** / **major**, bump `package.json`, refresh lockfiles, commit, tag `v${version}`, push (triggers the workflow above). |
| `npm run release:dry` | Prints what would happen; does not write or push. |
| `npm run release:ci` | Non-interactive; pass an increment after `--`, e.g. `npm run release:ci -- minor` (requires a clean git working tree unless you add flags yourself). |

Configuration is in [`.release-it.json`](../.release-it.json): **npm publish** and **GitHub release from release-it** are both **off** so the tag push only triggers CI to attach binaries. To also publish to npm, set `"npm": { "publish": true }` (and configure auth) in `.release-it.json`.

`src/cli.ts` still hardcodes `program.version('0.1.0')`; bump that when you care about `toby --version` matching the package, or add a release-it plugin such as `@release-it/bumper` later.

### One-liner install (end users)

From the repo root, [`install-toby.sh`](../install-toby.sh) downloads the **latest matching release asset** (`toby-darwin-*` / `toby-linux-*`) into **`~/.local/bin/toby`** (override with `TOBY_INSTALL_DIR`). It does not use `sudo`. If that directory is not on `PATH`, the script prints how to add it for zsh, bash, or fish.

Example after the script is published on your default branch:

```bash
curl -fsSL https://raw.githubusercontent.com/kshehadeh/toby/main/install-toby.sh | bash
```

Forks or mirrors can set `TOBY_REPO=owner/repo` or run the script from a git clone so `origin` is detected.
