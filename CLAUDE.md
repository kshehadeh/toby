# Toby — Developer Guide

## Project layout

Monorepo managed with Bun workspaces and Turbo.

```
apps/
  cli/          TypeScript CLI (Commander + Ink TUI) — primary harness
  web/          Vite + React settings/session UI
  toby-app/     Native macOS app (Swift 6 / SwiftUI, macOS 14+) — only native code in the repo
  plugin-*/     First-party plugins (all TypeScript bun-package format)
packages/
  core/         Shared harness types and utilities
```

## Plugin convention

All new plugins **must** be TypeScript bun-package plugins (directory with
`manifest.json` + TypeScript entrypoint, executed via Toby's bundled Bun
runtime). Do not create compiled binary or Swift plugins. The only native
macOS code in this repository is the Toby.app itself (`apps/toby-app/`).

When a plugin needs macOS framework access (EventKit, Shortcuts, system APIs,
TCC-protected resources), the TypeScript plugin delegates those operations to
Toby.app's native API server rather than compiling its own native binary. See
[`toby-plugin-macos`](apps/plugin-macos/) and
[`toby-plugin-applecalendar`](apps/plugin-applecalendar/) for reference.

## Running the app

```sh
bun run app          # build dev macOS app and open it
bun run dev          # run CLI in dev/watch mode
bun run dev:web      # run web UI dev server
```

## Tests

### TypeScript (CLI + plugins)
```sh
bun run test         # run all Vitest tests via Turbo
bun run test:watch   # watch mode for CLI tests only
```

### Swift (native macOS app — ViewInspector)
```sh
bun run test:swift   # swift test --package-path apps/toby-app
```

> **Prerequisite:** active developer directory must point to Xcode, not just CLT.
> Run once if needed: `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`

Swift tests live in `apps/toby-app/Tests/TobyAppTests/` and use the Swift Testing
framework (`import Testing`) with ViewInspector for SwiftUI view assertions.

## Building

```sh
bun run build:app       # build macOS .app bundle (dev variant)
bun run build:release   # full release build (all plugins + app)
bun run typecheck       # TypeScript type check across all packages
bun run lint            # Biome lint
bun run lint:fix        # Biome lint with auto-fix
```

## Adding Swift UI tests

1. Create a file in `apps/toby-app/Tests/TobyAppTests/`
2. Import `Testing`, `SwiftUI`, `@testable import TobyApp`, `ViewInspector`
3. Mark the suite `@MainActor` (all SwiftUI views are main-actor isolated)
4. Navigate view structure directly (e.g. `.vStack().hStack(1).button(3)`) rather
   than using `find(viewWithId:)` — system images without explicit `.accessibilityLabel()`
   create `AccessibilityImageLabel` modifiers that block ViewInspector tree traversal.

## CI

- `release.yml` — triggered on version tags; builds, signs, notarizes, and publishes
- `e2e.yml` (`.github/workflows/e2e.yml`) — runs Swift UI tests on every PR
- Requires Xcode on the runner: workflow selects it with `xcode-select` before testing
