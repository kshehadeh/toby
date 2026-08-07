---
name: toby-engineering-standards
description: >
  Repository-specific engineering culture review for Toby.app Swift code: ownership
  boundaries, design-system usage, file size, naming, DI consistency, tests, logging,
  and monorepo rules. Use after architecture review, for PR hygiene on apps/toby-app,
  or when the user runs /toby-engineering-standards. Complements (does not replace)
  swiftui-architecture-review.
---

# Toby Engineering Standards Review

## Goal

Enforce **Toby’s engineering culture** on Swift changes — organization-specific rules that
a generic SwiftUI reviewer must not invent or dilute.

This skill is **repository-specific**. It does not re-teach SwiftUI. Pair with
`swiftui-architecture-review` for framework correctness.

## Prerequisite

Load `.agents/context/swift-project-assessment.yaml` when present so conventions and
`Ignore` guidance stay aligned. If missing, continue with the rules below and suggest
running `/swift-project-assessment` for a fuller context pack.

## Operating rules

- Findings must cite a **named standard** from this skill (or linked skill/doc).
- Prefer **new and touched code**. Legacy bulk only when the user asks for a full audit
  or a file is being substantially rewritten.
- Do not duplicate SwiftUI property-wrapper / performance deep dives — hand those to
  `swiftui-architecture-review`.
- Do not demand product refactors that violate documented ownership (e.g. moving harness
  logic into the app, or adding Swift plugins).

## Standards checklist

### S1 — Module ownership

| Layer | Path | May contain | Must not |
| --- | --- | --- | --- |
| Features | `Sources/TobyApp/Features/*` | SwiftUI feature UI | Daemon business logic; raw TCC framework use that belongs in Native |
| Stores | `Sources/TobyApp/Stores/*` | `@Observable` UI state + client calls | Permanent product rules that belong in `@toby/core` |
| UI | `Sources/TobyApp/UI/*` | Shared primitives, theme, markdown | Feature-specific flows |
| Native | `Sources/TobyApp/Native/*` | TCC / framework bridges, native HTTP API | Chat transcript UI |
| Utilities / Models | `Utilities/`, `Models/` | Shared clients, DTOs, pure helpers | View trees |
| Core (TS) | `packages/core` | Harness, pipeline, plugins registry | Imported by Toby.app (forbidden) |
| Plugins | `apps/plugin-*` | TypeScript bun-package integrations | New compiled Swift/binary plugins |

**App ↔ daemon:** UI uses `TobyClient` / HTTP. **Plugins ↔ native:** plugins call
Toby.app `NativeServer`, not private app types.

Reference: `docs/architecture.md`, `Agents.md` Core vs CLI vs Toby.app table.

### S2 — Design system

- Colors, sidebar metrics, transcript typography → `AppTheme` / dynamic `NSColor` helpers.
- Settings/preferences chrome → `SettingsDesign` + `UI/SettingsControls/*`.
- Reuse `UI/Primitives` (`InputDock`, `ToastView`, `CopyButton`, …) before inventing twins.
- **Flag** hard-coded RGB/`Color(red:green:blue:)` for product surfaces when tokens exist.
- **Flag** one-off settings row layouts that ignore `SettingsRow` / `SettingsCard` patterns
  in new settings UI.

### S3 — Dependency injection consistency

- Feature roots take stores via initializers (match existing features).
- App entry owns long-lived stores with `@State` (`TobyApp.swift`).
- `@Environment` for scene values (`openWindow`) and intentional shared env objects
  (`AppearancePreferences`).
- New global singletons require justification; prefer injection.
- Do not introduce third-party DI frameworks without an explicit human decision.

### S4 — File size & cohesion

Soft limits for **new or substantially edited** files:

| Kind | Soft max | Action when over |
| --- | --- | --- |
| SwiftUI view | ~400 lines | Extract subviews / section files |
| Store | ~600 lines | Split by concern or helper types |
| Aggregate models | ~800 lines | Split DTOs by domain |
| Any file | **1000+ lines** | **major** — require a split plan unless assessment lists it as known risk under active work |

Known large magnets (do not drive-by rewrite unless in scope): `RootView.swift`,
`ChatStore.swift`, `Models.swift`, `TobyClient.swift`, `NativeMacOSHandler.swift`.
When touching them, prefer **net line reduction** or extracted helpers over growth.

One type (or tightly coupled small set) per file is preferred; avoid dumping unrelated
types into a convenience file.

### S5 — Naming

- Types: `UpperCamelCase`; feature prefix when shared names collide (`RecordingHeader`).
- Views: `*View`, rows `*Row`, sidebars `*SidebarView`, stores `*Store`.
- Booleans: `is` / `has` / `should` prefixes consistent with neighbors.
- Match folder name to feature name (`Features/Schedules/*`).

### S6 — Windows & scenes

Any new or changed `Window` / `WindowGroup` must satisfy **`toby-native-window`** hard rules.
Flag registration outside `TobyApp.swift`, missing sidebar toolbar patterns, or Settings
`TabView` regressions.

### S7 — Tests

From `Claude.md` / project practice:

- Location: `apps/toby-app/Tests/TobyAppTests/`
- `import Testing`, `@testable import TobyApp`, ViewInspector for UI
- Suites that touch SwiftUI: **`@MainActor`**
- Prefer structural inspection (`.vStack().hStack(1)…`) or
  `find(viewWithAccessibilityIdentifier:)` over `find(viewWithId:)` when SF Symbol
  `AccessibilityImageLabel` blocks traversal
- New user-visible behavior or store logic → add/update tests
- Run `bun run test:swift` when Swift tests change (note Xcode developer dir prerequisite)

### S8 — Logging & user-visible errors

- Prefer existing app patterns (`ServerEventLog`, store `activityLine` / toast) over
  ad-hoc `print` in production paths
- User-facing failures should surface in UI (toast/status), not only console
- No secrets, tokens, or full credential payloads in logs

### S9 — Security & privacy

- No API keys or tokens in the Swift sources or test fixtures
- Appearance/`UserDefaults` is not a credentials store (Keychain / daemon credentials only)
- TCC prompts and privileged APIs stay behind `Native/*` handlers

### S10 — Docs when behavior changes

If the change alters user-visible or developer-documented behavior, flag missing
`docs/` and/or `apps/help-site/docs/` updates and point to **`toby-docs`**.

### S11 — Monorepo / plugin policy

- **Do not** add first-party integrations under `packages/core/src/integrations/<name>/`
  (plugins only; `BUILTIN_MODULES` empty by design)
- **Do not** create compiled binary or Swift plugins; TypeScript bun-package only
- Native macOS product code lives only in `apps/toby-app/`

## Scope selection

Same as architecture review: uncommitted diff, PR, or named feature under `apps/toby-app`.
Optionally include related tests and window registration in `TobyApp.swift`.

## Output format

Organize by file. Each finding:

1. **Standard ID** (e.g. `S4 File size`, `S2 Design system`)
2. **File:line** when possible
3. **Severity**: blocker | major | minor | note
4. **Expected convention** + concrete fix direction

End with:

### Summary

- Counts by severity
- Ownership or design-system themes
- Explicit **waivers** (e.g. known large file touched only for a one-line fix)

### Combined review note

If `swiftui-architecture-review` already ran, do not restate its SwiftUI findings —
only add standards gaps. If it has not run, list “recommended next: architecture review”.

## Related skills

| Skill | Relationship |
| --- | --- |
| `swift-project-assessment` | Context / conventions snapshot |
| `swiftui-architecture-review` | Framework & architecture correctness |
| `toby-native-window` | Window implementation rules (S6) |
| `toby-docs` | Documentation follow-through (S10) |
| `toby-swift-review` | Runs this after architecture review |
| `swiftui-pro` / `swiftui-expert-skill` | Not substitutes for this skill |
