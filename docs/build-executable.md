# Standalone executable (Bun)

You can ship Toby as a macOS executable plus its listener helper using:

```bash
bun install
bun run build:executable
```

The main executable output is **`dist/toby`**.
The macOS listener helper is copied to **`dist/toby-listener`** and should be
installed beside `toby`.

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

- **`ink`**: If a new version still imports `yoga-wasm-web/auto`, re-apply the import swap to `../../yoga-wasm-web/dist/ink-default.js` (from each `build/*.js` file), then `bunx patch-package ink`.
- **`yoga-wasm-web`**: If the asm entry or package exports change, refresh **`patches/yoga-wasm-web+0.3.3.patch`** (re-add `dist/ink-default.js` and the `./ink-default` export if needed), then `bunx patch-package yoga-wasm-web`.

## Cross-compilation

Toby releases are macOS-only. To cross-compile just the Bun executable for
another macOS architecture from a machine that has Bun:

```bash
bun build ./src/cli.ts --compile --target=bun-darwin-x64 --outfile ./dist/toby-darwin-x64
```

See [Bun’s executable docs](https://bun.sh/docs/bundler/executables) for `--target` values.

## `tsup` library build

`bun run build` produces **`dist/cli.js`** via **tsup** (for linking, `bun link`, or publishing). The standalone Bun binary is an **optional** distribution path.

## GitHub Releases (CI)

Pushing a **version tag** matching `v*` runs [`.github/workflows/release.yml`](../.github/workflows/release.yml):

1. Matrix builds **two** signed and notarized macOS archives:
   `toby-darwin-arm64.zip` and `toby-darwin-x64.zip`.
2. Each archive contains `toby` and `toby-listener`.
3. Creates a **GitHub Release** for that tag and uploads those files as release assets (via `softprops/action-gh-release`).

The release workflow uses the same Apple Developer secrets as DevDash:

- `CSC_LINK` — base64-encoded Developer ID Application `.p12`
- `CSC_KEY_PASSWORD` — certificate password
- `APPLE_ID` — Apple Developer account email
- `APPLE_APP_SPECIFIC_PASSWORD` — app-specific password for notarization
- `APPLE_TEAM_ID` — Apple Developer Team ID

Create `CSC_LINK` by base64-encoding the Developer ID Application `.p12`:

```bash
base64 -i /path/to/developer-id-application.p12 | tr -d '\n' | pbcopy
```

`CSC_KEY_PASSWORD` is the password used when exporting that `.p12` from
Keychain Access.

Signing is optional for CI mechanics but required for browser-downloaded
executables to pass Gatekeeper. If any of the five signing/notarization secrets
are missing, the workflow skips signing and notarization and uploads an unsigned
archive with a warning. Invalid non-empty credentials fail the release instead
of silently publishing an unexpectedly unsigned build.

Local `bun run build:executable` builds `dist/toby` and `dist/toby-listener`
without signing. Use the GitHub release workflow for signed and notarized
distribution artifacts.

Ensure **Actions** permissions allow the default `GITHUB_TOKEN` to create releases for tag pushes (Repository → Settings → Actions → General → Workflow permissions → read and write).

### Shipping a release with release-it

This repo uses **[release-it](https://github.com/release-it/release-it)** so you do not have to hand-cut tags:

| Script | Purpose |
| ------ | ------- |
| `bun run release` | Interactive: choose **patch** / **minor** / **major**, bump `package.json`, refresh lockfiles, commit, tag `v${version}`, push (triggers the workflow above). |
| `bun run release:dry` | Prints what would happen; does not write or push. |
| `bun run release:ci` | Non-interactive; pass an increment after `--`, e.g. `bun run release:ci -- minor` (requires a clean git working tree unless you add flags yourself). |

Configuration is in [`.release-it.json`](../.release-it.json): publishing to the **npm registry** and **GitHub release from release-it** are both **off** so the tag push only triggers CI to attach binaries. To also publish the package to the registry, set `"npm": { "publish": true }` (and configure auth) in `.release-it.json`.

`src/cli.ts` resolves version from `package.json` by default (with optional `TOBY_VERSION` override), so `toby --version` stays in sync with releases.

### One-liner install (end users)

From the repo root, [`install-toby.sh`](../install-toby.sh) downloads the
**latest matching macOS release archive** into **`~/.local/bin/toby`** and
**`~/.local/bin/toby-listener`** (override with `TOBY_INSTALL_DIR`). It does not
use `sudo`. If that directory is not on `PATH`, the script prints how to add it
for zsh, bash, or fish.

Example after the script is published on your default branch:

```bash
curl -fsSL https://raw.githubusercontent.com/kshehadeh/toby/main/install-toby.sh | bash
```

Forks or mirrors can set `TOBY_REPO=owner/repo` or run the script from a git clone so `origin` is detected.
