# Standalone executable (Bun)

You can ship Toby as a macOS executable using:

```bash
bun install
bun run build:executable
```

The main executable output is **`dist/toby`**.
Installable plugins are built to **`dist/toby-plugin-sample-ts`**,
**`dist/toby-plugin-email`**, **`dist/toby-plugin-todoist`**, and other
first-party plugin directories (see `bun run build:plugins`). Release installs
and upgrades copy first-party plugins into `~/.toby/plugins/` automatically; when
building from source, install with `toby plugins install ./dist/...` (see
[`docs/plugin-protocol.md`](plugin-protocol.md)).

## Requirements

- **[Bun](https://bun.sh)** installed locally (used only at build time; end users do not need Bun to *run* the binary).
- Dependencies installed before building.

## How the CLI is bundled

Release and local executable builds use **Bun only** (no tsup):

1. **Entry:** [`apps/cli/src/cli.ts`](../apps/cli/src/cli.ts)
2. **Workspace:** `@toby/core` is a normal workspace dependency of `@toby/cli`; integration npm packages stay on [`packages/core/package.json`](../packages/core/package.json) only.
3. **Compile:** `bun build` runs from **`apps/cli`** so the resolver sees `@toby/core` and bundles the full dependency graph into `dist/toby`.

[`scripts/build-release-artifacts.sh`](../scripts/build-release-artifacts.sh) (CI) and `bun run build:executable` use:

```bash
cd apps/cli
bun build ./src/cli.ts --compile --target=bun-darwin-arm64 --outfile ../../dist/toby
```

Non-compiled bundle for the `toby` bin (`./dist/cli.js`):

```bash
bun run --cwd apps/cli build
```

## Cross-compilation

Toby releases are macOS-only. To cross-compile just the Bun executable for
another macOS architecture from a machine that has Bun:

```bash
cd apps/cli
bun build ./src/cli.ts --compile --target=bun-darwin-x64 --outfile ../../dist/toby-darwin-x64
```

See [Bun’s executable docs](https://bun.sh/docs/bundler/executables) for `--target` values.

## GitHub Releases (CI)

Pushing a **version tag** matching `v*` runs [`.github/workflows/release.yml`](../.github/workflows/release.yml). The workflow calls [`scripts/build-release-artifacts.sh`](../scripts/build-release-artifacts.sh) (same layout as local `bun run build:release` on macOS with `BUN_TARGET` / `SWIFT_ARCH` set).

Release build steps:

1. Builds the signed and notarized macOS DMG, currently `Toby-arm64.dmg`.
2. The DMG contains `Toby.app`; the app bundle contains `toby`, `bun`
   (runtime for bun-package plugins), the web UI, icons, and first-party
   plugins including `toby-plugin-sample-ts`, `toby-plugin-email`,
   `toby-plugin-todoist`, `toby-plugin-jira`, `toby-plugin-notion`, `toby-plugin-slack`,
   `toby-plugin-applecalendar`, `toby-plugin-applecontacts`,
   `toby-plugin-applereminders`, and `toby-plugin-macos`.
3. The workflow signs and notarizes `Toby.app`, then builds, notarizes, and
   staples the DMG.
4. Sparkle generates a signed `appcast.xml` from the notarized DMG and publishes
   it to the `gh-pages` branch at `/appcast.xml`.
5. Creates a **GitHub Release** for that tag and uploads the DMG plus appcast as
   release assets (via `softprops/action-gh-release`).

The release workflow uses the same Apple Developer secrets as DevDash:

- `CSC_LINK` — base64-encoded Developer ID Application `.p12`
- `CSC_KEY_PASSWORD` — certificate password
- `APPLE_ID` — Apple Developer account email
- `APPLE_APP_SPECIFIC_PASSWORD` — app-specific password for notarization
- `APPLE_TEAM_ID` — Apple Developer Team ID
- `SPARKLE_PUBLIC_KEY` — public EdDSA key embedded into `Toby.app` as
  `SUPublicEDKey`
- `SPARKLE_PRIVATE_KEY` — private EdDSA key used only in CI to sign the
  Sparkle appcast entry

Create `CSC_LINK` by base64-encoding the Developer ID Application `.p12`:

```bash
base64 -i /path/to/developer-id-application.p12 | tr -d '\n' | pbcopy
```

`CSC_KEY_PASSWORD` is the password used when exporting that `.p12` from
Keychain Access.

Signing is optional for CI mechanics but required for browser-downloaded
executables to pass Gatekeeper. If any Apple signing or notarization secrets
are missing, the workflow skips signing and notarization and uploads an unsigned
archive with a warning. If Sparkle keys are missing, the workflow still builds
the release but skips `appcast.xml` generation. Invalid non-empty Apple
credentials fail the release instead of silently publishing an unexpectedly
unsigned build.

Generate Sparkle keys once on a trusted Mac with Sparkle's release tools:

```bash
generate_keys
```

Store the public key in `SPARKLE_PUBLIC_KEY` and the private key in
`SPARKLE_PRIVATE_KEY`. Do not reuse Apple Developer ID certificates for Sparkle;
Sparkle's EdDSA update signature is separate from code signing and
notarization.

Local `bun run build:release` builds `dist/toby`, `dist/bun`, `dist/Toby.app`,
and first-party plugin directories (`dist/toby-plugin-sample-ts`,
`toby-plugin-email`, `todoist`, `jira`, `notion`, `slack`, `applecalendar`,
`applecontacts`, `applereminders`, `macos`). Verify staged artifacts with
`node scripts/verify-release-artifacts.mjs release-payload`.
Use the GitHub release workflow for signed and notarized distribution artifacts.

`scripts/build-app.sh` stamps `CFBundleShortVersionString` from `package.json`
by default and `CFBundleVersion` from `TOBY_APP_BUILD_NUMBER` or
`GITHUB_RUN_NUMBER`. Sparkle update ordering depends on these bundle values.

Note that `bun run build:executable` is a lighter dev build. It does run
`build:plugins` (all first-party plugin packages). Web Search is a built-in
global tool in core, not a separate plugin.

Ensure **Actions** permissions allow the default `GITHUB_TOKEN` to create releases for tag pushes (Repository → Settings → Actions → General → Workflow permissions → read and write).

### Shipping a release with release-it

This repo uses **[release-it](https://github.com/release-it/release-it)** so you do not have to hand-cut tags:

| Script | Purpose |
| ------ | ------- |
| `bun run release` | Interactive: choose **patch** / **minor** / **major**, bump `package.json`, refresh lockfiles, commit, tag `v${version}`, push (triggers the workflow above). |
| `bun run release:dry` | Prints what would happen; does not write or push. |
| `bun run release:ci` | Non-interactive; pass an increment after `--`, e.g. `bun run release:ci -- minor` (requires a clean git working tree unless you add flags yourself). |

Configuration is in [`.release-it.json`](../.release-it.json): publishing to the **npm registry** and **GitHub release from release-it** are both **off** so the tag push only triggers CI to attach binaries. To also publish the package to the registry, set `"npm": { "publish": true }` (and configure auth) in `.release-it.json`.

`apps/cli/src/cli.ts` resolves version from `package.json` by default (with optional `TOBY_VERSION` override), so `toby --version` stays in sync with releases.

### One-liner install (end users)

From the repo root, [`install-toby.sh`](../install-toby.sh) downloads the
**latest matching macOS release archive** and installs the `toby` binary into
**`~/.local/bin/toby`** (override with `TOBY_INSTALL_DIR`). The bundled `bun` runtime is placed under **`~/.toby/helpers/`**, and first-party plugins (`toby-plugin-sample-ts`,
`toby-plugin-email`, `toby-plugin-todoist`, `toby-plugin-jira`, `toby-plugin-notion`, `toby-plugin-slack`, `toby-plugin-applecalendar`, `toby-plugin-applecontacts`, `toby-plugin-applereminders`, `toby-plugin-macos`) under **`~/.toby/plugins/`**, so only `toby` lands on your
`PATH`. It does not use `sudo`. If the install directory is not on `PATH`, the
script prints how to add it for zsh, bash, or fish.

Example after the script is published on your default branch:

```bash
curl -fsSL https://raw.githubusercontent.com/kshehadeh/toby/main/install-toby.sh | bash
```

Forks or mirrors can set `TOBY_REPO=owner/repo` or run the script from a git clone so `origin` is detected.
