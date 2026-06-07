---
name: release-toby
description: Perform Toby project releases using release-it, macOS release archives, and installer/self-upgrade checks. Use when the user asks to cut, prepare, dry-run, tag, or troubleshoot a Toby release.
---

# Release Toby

## Goal

Prepare and cut a Toby release safely. Toby is a macOS-focused CLI; release
assets are macOS archives containing both `toby` and `toby-listener`.

**Default for agents:** use non-interactive release-it mode so prompts are skipped:

```bash
bun run release -- <patch|minor|major> --ci
```

The `--` passes `<increment>` and `--ci` through to `release-it`.

## Source Of Truth

- Release docs: `docs/build-executable.md`
- Release script: `bun run release` (wraps `release-it`)
- Release config: `.release-it.json`
- CI workflow: `.github/workflows/release.yml`
- Installer: `install-toby.sh`
- Self-upgrade logic: `apps/cli/src/upgrade/index.ts` (stages and installs
  `toby-plugin-sample`, `toby-plugin-azuread`, and `toby-plugin-gmail`)

## Release Shape

Tag pushes matching `v*` run the GitHub Actions release workflow.

Expected assets:

- `toby-darwin-arm64.zip`
- `toby-darwin-x64.zip`

Each archive must contain:

- `toby`
- `toby-listener`
- `toby-plugin-sample`
- `toby-plugin-azuread`
- `toby-plugin-gmail`

Do not add Linux release assets; this project is macOS-focused.

Signed browser-safe releases require these GitHub Actions secrets:

- `CSC_LINK` — base64-encoded Developer ID Application `.p12`
- `CSC_KEY_PASSWORD` — certificate export password
- `APPLE_ID` — Apple Developer account email
- `APPLE_APP_SPECIFIC_PASSWORD` — notarization app-specific password
- `APPLE_TEAM_ID` — Apple Developer Team ID

If any signing secret is missing, CI skips signing/notarization and uploads an
unsigned archive. Invalid non-empty credentials should fail the release.

## Cutting The Release

```bash
bun run release -- patch --ci
bun run release -- minor --ci
bun run release -- major --ci
```

Always include `--ci` when cutting a release without a human at the terminal.
`--ci` skips release-it prompts (version bump confirmation, publish questions,
etc.).

`release-it` bumps `package.json`, refreshes `bun.lock` via the `after:bump`
hook, creates a `chore(release): v${version}` commit, creates tag `v${version}`,
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
