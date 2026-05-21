---
name: release-toby
description: Perform Toby project releases using release-it, macOS release archives, and installer/self-upgrade checks. Use when the user asks to cut, prepare, dry-run, validate, tag, or troubleshoot a Toby release.
---

# Release Toby

## Goal

Prepare and cut a Toby release safely. Toby is a macOS-focused CLI; release
assets are macOS archives containing both `toby` and `toby-listener`.

## Source Of Truth

- Release docs: `docs/build-executable.md`
- Release script: `bun run release <patch|minor|major>`
- Release config: `.release-it.json`
- CI workflow: `.github/workflows/release.yml`
- Installer: `install-toby.sh`
- Self-upgrade logic: `src/upgrade/index.ts`

## Release Shape

Tag pushes matching `v*` run the GitHub Actions release workflow.

Expected assets:

- `toby-darwin-arm64.zip`
- `toby-darwin-x64.zip`

Each archive must contain:

- `toby`
- `toby-listener`

Do not add Linux release assets; this project is macOS-focused.

Signed browser-safe releases require these GitHub Actions secrets:

- `CSC_LINK` — base64-encoded Developer ID Application `.p12`
- `CSC_KEY_PASSWORD` — certificate export password
- `APPLE_ID` — Apple Developer account email
- `APPLE_APP_SPECIFIC_PASSWORD` — notarization app-specific password
- `APPLE_TEAM_ID` — Apple Developer Team ID

If any signing secret is missing, CI skips signing/notarization and uploads an
unsigned archive. Invalid non-empty credentials should fail the release.

## Preflight

1. Inspect state:

```bash
git status --porcelain
git log -n 5 --oneline
```

2. Verify no unrelated uncommitted work would be swept into the release.
3. Confirm the intended increment: `patch`, `minor`, or `major`.
4. Run checks:

```bash
bun run typecheck
bun run test
bun run build:executable
```

5. Verify local build outputs:

```bash
ls -lah dist/toby dist/toby-listener
./dist/toby --version
./dist/toby-listener --version
```

## Dry Run

Use this before cutting unless the user explicitly says to skip:

```bash
bun run release:dry
```

If using the non-interactive path:

```bash
bun run release:ci -- patch
```

Replace `patch` with the confirmed increment.

## Cutting The Release

Interactive:

```bash
bun run release
```

Non-interactive:

```bash
bun run release:ci -- <patch|minor|major>
```

`release-it` bumps `package.json`, refreshes `bun.lock` via the `after:bump`
hook, creates a `chore(release): v${version}` commit, creates tag `v${version}`,
and pushes. The tag push triggers `.github/workflows/release.yml`.

## Post-Release Verification

After GitHub Actions finishes:

1. Confirm both macOS archives exist on the GitHub Release.
2. Download and inspect one archive:

```bash
unzip -l toby-darwin-arm64.zip
```

3. Smoke test install script with the release tag when appropriate:

```bash
TOBY_VERSION=vX.Y.Z ./install-toby.sh
```

4. Verify installed binaries:

```bash
toby --version
toby-listener --version
```

## Safety Notes

- Never force-push release tags unless the user explicitly requests it.
- If the release commit/tag already exists, stop and inspect before retrying.
- If CI fails, fix forward with a new commit and tag unless the user explicitly
  asks to delete/recreate the tag.
- Keep release messages Conventional Commit compatible.
