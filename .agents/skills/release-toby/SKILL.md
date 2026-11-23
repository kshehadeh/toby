---
name: release-toby
description: Perform Toby project releases using release-it, the signed Toby.app DMG, and the Sparkle appcast. Use when the user asks to cut, prepare, dry-run, tag, or troubleshoot a Toby release.
---

# Release Toby

## Goal

Prepare and cut a Toby release safely. Toby is a single native macOS app; the
release ships a signed, notarized `Toby-arm64.dmg` containing `Toby.app` plus a
Sparkle `appcast.xml`.

**Default for agents:** use non-interactive release-it mode so prompts are skipped:

```bash
bun run release -- <patch|minor|major> --ci
```

The `--` passes `<increment>` and `--ci` through to `release-it`.

## Source Of Truth

- App version: `VERSION` (read by `scripts/build-app.sh`; `package.json`
  `version` is kept in sync by release-it)
- Release script: `bun run release` (wraps `release-it`)
- Release config: `.release-it.json`
- Build: `scripts/build-release-artifacts.sh` → `scripts/build-app.sh`
  (`TOBY_APP_VARIANT=production`), checked by `scripts/verify-release-artifacts.mjs`
- CI workflow: `.github/workflows/release.yml`
- Installer: `install-toby.sh` (installs `Toby.app`; removes a legacy `toby` CLI)

## Release Shape

Tag pushes matching `v*` run the GitHub Actions release workflow, which builds
`Toby.app`, signs it (Sparkle framework first, then the app), notarizes and
staples it, builds and notarizes the DMG, and publishes `Toby-arm64.dmg` and
`appcast.xml` to the GitHub release (plus the legacy GitHub Pages appcast).

`Toby.app` must contain `Contents/MacOS/toby-app`, `Frameworks/Sparkle.framework`,
and the SwiftPM resource bundles (`*_TobyCore.bundle` with persona images and
tool definitions). It must **not** contain the old `toby` CLI, `bun`, `web/`,
or `toby-plugin-*`; the verifier fails if they appear.

Do not add Linux release assets; this project is macOS-only.

Signed browser-safe releases require these GitHub Actions secrets:

- `CSC_LINK` — base64-encoded Developer ID Application `.p12`
- `CSC_KEY_PASSWORD` — certificate export password
- `APPLE_ID` — Apple Developer account email
- `APPLE_APP_SPECIFIC_PASSWORD` — notarization app-specific password
- `APPLE_TEAM_ID` — Apple Developer Team ID
- `SPARKLE_PUBLIC_KEY` / Sparkle private key secrets for the appcast

If any signing secret is missing, CI skips signing/notarization and uploads an
unsigned build. Invalid non-empty credentials should fail the release.

## Cutting The Release

```bash
bun run release -- patch --ci
bun run release -- minor --ci
bun run release -- major --ci
```

Always include `--ci` when cutting a release without a human at the terminal.
`--ci` skips release-it prompts (version bump confirmation, publish questions,
etc.).

`release-it` bumps `package.json`, writes `VERSION` and refreshes `bun.lock` via
the `after:bump` hook, creates a `chore(release): v${version}` commit, creates tag `v${version}`,
and pushes. The tag push triggers `.github/workflows/release.yml`.

`bun run release:ci -- <patch|minor|major>` is a thin wrapper around the same
`release-it <increment> --ci` invocation; prefer `bun run release -- … --ci`
for consistency.

## Safety Notes

- Never force-push release tags unless the user explicitly requests it.
- If the release commit/tag already exists, stop and inspect before retrying.
- If CI fails, fix forward with a new commit and tag unless the user explicitly
  asks to delete/recreate the tag.
- Keep release messages Conventional Commit compatible.
