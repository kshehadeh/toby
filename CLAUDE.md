# Toby — Developer Guide

Toby is a single native macOS app (Swift 6 / SwiftUI, macOS 26+). No
TypeScript runtime, CLI, daemon, local HTTP server, plugins, or MCP; AI goes
through OpenRouter via the in-repo TobyAI module. See [`AGENTS.md`](AGENTS.md)
for the full architecture and conventions.

## Project layout

```
apps/
  toby-app/     Swift package — TobyApp, TobyCore, TobyAI, TobyStore, TobyMail
  help-site/    Public docs site (Next.js, Vercel)
scripts/        build-app.sh, release, dev-loop and screenshot scripts
VERSION         App version
```

New capabilities (sources, tools, background work) are Swift services in
`TobyCore`, exposed to chat through `ChatToolbox` and to the UI through
`NativeRuntime` / `TobyClient`. macOS framework access (EventKit, Contacts,
audio, TCC) stays in `Sources/TobyApp/Native/`, reached via `NativeBridge` →
`NativeDispatcher`.

Feed state lives in the native database. The first Feed load or database backup imports the legacy dashboard JSON files. Older builds read the original JSON snapshot.

## Running the app

```sh
bun run app          # build dev macOS app and open it
bun run dev:upgrade-available  # Dev app with a fake pending update (toolbar + tip)
bun run dev:sandbox  # Dev app against a temp TOBY_DIR
```

Never point development builds at a real `~/.toby` you care about: the first
launch imports it and removes legacy daemon files. Copy it to a scratch
`TOBY_DIR` instead.

## Tests

```sh
bun run test         # swift test --package-path apps/toby-app
```

> **Prerequisite:** active developer directory must point to Xcode, not just CLT.
> Run once if needed: `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`

- Core suites: `Tests/TobyCoreTests`, `TobyAITests`, `TobyStoreTests`, `TobyMailTests`.
- UI tests: `Tests/TobyAppTests/` use Swift Testing (`import Testing`) with
  ViewInspector. Known pre-existing ViewInspector failures and a signal-5
  runner crash exist; compare against a baseline worktree.
- Test processes always use a temporary Toby home.

## Adding Swift UI tests

1. Create a file in `apps/toby-app/Tests/TobyAppTests/`
2. Import `Testing`, `SwiftUI`, `@testable import TobyApp`, `ViewInspector`
3. Mark the suite `@MainActor` (all SwiftUI views are main-actor isolated)
4. Navigate view structure directly (e.g. `.vStack().hStack(1).button(3)`) rather
   than using `find(viewWithId:)` — system images without explicit `.accessibilityLabel()`
   create `AccessibilityImageLabel` modifiers that block ViewInspector tree traversal.

## Building

```sh
bun run build:app       # build macOS .app bundle (dev variant)
bun run build:release   # production Toby.app (signed/notarized in CI)
bun run build:dmg       # release build + DMG
bun run lint            # Biome (help site + scripts)
bun run typecheck       # help site TypeScript
```

The app version comes from `VERSION`; `bun run release -- <patch|minor|major> --ci`
bumps it (see the `release-toby` skill).

The app icon is `images/app-icon.png`, a dark squircle with the white-outlined
face baked in (macOS 26 jails transparent freeform icons), packaged as
`AppIcon.icns` by `scripts/build-app-icon.sh`. The freeform face artwork is
`images/toby-face.png`. DMG packaging requires
macOS 26+ and Python 3.11+; `scripts/build-dmg.sh` installs pinned build-only
dependencies in `dist/.dmg-tools` and configures Finder without GUI automation.
Its layout is in `scripts/dmg-settings.py`. Rebuild the checked-in 1×/2×
backgrounds with `swift scripts/render-dmg-background.swift` after artwork changes.
Run packaging checks with `dist/.dmg-tools/bin/python scripts/test-packaging.py`;
add `--volume <mount-path>` to also verify the final mounted DMG.

## Swift review skills (agents)

| Skill | Purpose |
| ----- | ------- |
| `swift-project-assessment` | Repo context → `.agents/context/swift-project-assessment.yaml` |
| `swiftui-architecture-review` | Framework + architecture review (assumes assessment) |
| `toby-engineering-standards` | Ownership, design system, tests, file size, single-app policy |
| `toby-swift-review` | Orchestrator (assessment → architecture → standards) |

Deep SwiftUI references remain in `swiftui-pro` and `swiftui-expert-skill`.
Window chrome: `toby-native-window`.

## CI

- `release.yml` — triggered on version tags; builds, signs, notarizes, and publishes
  the DMG and Sparkle `appcast.xml`. Its GitHub Pages job only publishes the
  appcast. Builds from v0.194.3 read `https://www.tobyai.app/appcast.xml` (Vercel
  redirects it to the latest release asset); v0.194.2 and earlier read
  `https://kshehadeh.github.io/toby/appcast.xml`, so keep the Pages job until
  those installs have updated
- Help site — Vercel project `toby-docs` (Git integration) deploys production on
  every merge to `main` that touches `apps/help-site/` (config in
  `apps/help-site/vercel.json`); serves `www.tobyai.app` (`tobyai.app` redirects
  there; shipped app builds still link to the legacy `toby.iwonderdesigns.com`)
- `e2e.yml` (`.github/workflows/e2e.yml`) — runs Swift tests on every PR
- Requires Xcode on the runner: workflow selects it with `xcode-select` before testing
