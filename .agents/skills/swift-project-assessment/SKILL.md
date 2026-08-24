---
name: swift-project-assessment
description: >
  Establish repository-level Swift/SwiftUI project context for Toby.app (architecture,
  conventions, frameworks, feature boundaries). Produces a durable assessment artifact
  that later review skills consume. Use when starting a Swift/macOS review, onboarding
  to apps/toby-app, refreshing project context, or when the user runs /swift-project-assessment.
  Never nitpicks code quality — context only.
---

# Swift Project Assessment

## Goal

Answer **what this Swift project is** and **how it is intentionally structured**. Produce a
machine-readable assessment that downstream skills can load without rediscovering the repo.

**Never nitpick code.** Do not report style issues, bugs, or refactors here. Those belong to
`swiftui-architecture-review` and `toby-engineering-standards`.

## When to run

- Before any non-trivial SwiftUI review or large feature work in `apps/toby-app/`
- When `Package.swift`, folder layout, or architectural conventions change
- When `.agents/context/swift-project-assessment.yaml` is missing, stale (>30 days), or clearly wrong
- When the user asks for project context, architecture overview, or `/swift-project-assessment`

## Artifact

Write (or update) the assessment to:

```
.agents/context/swift-project-assessment.yaml
```

Schema: see `references/assessment-schema.md`.

Also print a short human summary in chat (bullet list of architecture + review guidance).
Do **not** dump the full YAML into chat unless the user asks.

## Operating rules

1. **Read first, then write.** Prefer evidence from the repo over assumptions.
2. **Mark confidence.** Use `intentional` / `likely` / `uncertain` for non-obvious patterns.
3. **Scope = Toby.app.** Primary target is `apps/toby-app/`. Note monorepo context only as it
   affects the app (daemon HTTP client, native API for plugins). Do not assess TypeScript packages
   as if they were Swift.
4. **Respect sibling skills.** Record pointers; do not duplicate their checklists:
   - `toby-native-window` — window chrome patterns
   - `swiftui-expert-skill` / `swiftui-pro` — framework best-practice references
   - `toby-engineering-standards` — org/repo rules
5. **Ignore code quality.** Large files, missing tests, anti-patterns → list under
   `Potential Risks` only if they are **structural** risks, not review findings.

## Workflow

### 1) Load prior assessment (if any)

```bash
# If present, use as a baseline to refresh, not as ground truth.
test -f .agents/context/swift-project-assessment.yaml && echo exists
```

### 2) Gather facts (read-only)

| Source | Extract |
| --- | --- |
| `apps/toby-app/Package.swift` | Swift tools version, platforms, products, deps, linked frameworks |
| `apps/toby-app/Sources/TobyApp/` tree | Feature folders, Stores, UI, Native, App entry |
| `TobyApp.swift`, `RootView.swift` | Scene graph, store ownership, injection style |
| One or two `*Store.swift` files | Observation / concurrency / MainActor pattern |
| `UI/Theme/`, `UI/Primitives/`, `UI/SettingsControls/` | Design system surfaces |
| `Tests/TobyAppTests/` | Test framework (Swift Testing, ViewInspector) |
| `Claude.md`, `Agents.md`, `docs/architecture.md`, `docs/native-helpers.md` | Documented conventions |
| `.agents/skills/toby-native-window/SKILL.md` | Window pattern inventory |

Useful probes:

```bash
# Platforms / tools version
head -20 apps/toby-app/Package.swift

# Observation / state patterns (sample, not exhaustive audit)
rg -n '@Observable|@StateObject|ObservableObject|@Environment|@MainActor' apps/toby-app/Sources --glob '*.swift' | head -40

# Feature boundaries
ls apps/toby-app/Sources/TobyApp/Features
ls apps/toby-app/Sources/TobyApp/Stores
```

### 3) Classify architecture

Fill these fields (names match the schema):

- **App kind** — e.g. native macOS menu-bar + multi-window product UI
- **Architectural pattern** — e.g. feature folders + `@Observable` stores (MVVM-like; not VIPER)
- **Swift / deployment target**
- **Observation** — `@Observable` + `@State` ownership vs Combine/`ObservableObject`
- **Navigation** — `NavigationSplitView`, multi-`Window`/`WindowGroup`, settings patterns
- **Persistence** — daemon/SQLite via HTTP; local `UserDefaults` for appearance; no SwiftData expected
- **DI** — initializer injection of stores into root; `@Environment` for openWindow / shared prefs
- **Networking** — `TobyClient` → local daemon; `NativeServer` for TCC-gated plugin APIs
- **UIKit/AppKit** — AppKit allowed where necessary (window chrome, menu bar, native bridges); prefer SwiftUI for product UI
- **Feature boundaries** — list major `Features/*` modules and shared layers (`Stores`, `UI`, `Native`, `Models`)

### 4) Capture conventions & review guidance

`Repository Conventions` must include concrete, evidence-backed rules agents should follow later, e.g.:

- Feature-based folders under `Sources/TobyApp/Features/`
- Shared design system: `AppTheme`, `SettingsDesign`, settings controls
- SPM package (not Xcode project as source of truth)
- Swift Testing + ViewInspector; suites `@MainActor`; prefer structural navigation over `find(viewWithId:)` for SF Symbols
- Windows registered in `TobyApp.swift`; see `toby-native-window`

`Review Guidance` tells downstream reviewers **what to prefer / ignore**, e.g.:

- Prefer Observation (`@Observable`) recommendations; do not suggest migrating to `ObservableObject`
- Do not recommend UIKit migration or iOS-only APIs
- Validate colors/spacing against `AppTheme` / `SettingsDesign`
- Native TCC work stays in `Native/`; product UI talks HTTP to daemon/native server
- Ignore “add SwiftData” unless persistence requirements change

`Potential Risks` are structural only (e.g. shared stores growing unbounded, client API surface size).

### 5) Write the artifact

Overwrite `.agents/context/swift-project-assessment.yaml` with a complete document.
Set `assessed_at` to today’s date (ISO `YYYY-MM-DD`) and `source: swift-project-assessment`.

### 6) Chat summary (short)

```
Project: Toby.app — macOS 26+ SwiftUI product UI over local daemon
Architecture: Feature folders + @Observable @MainActor stores
Key guidance: …
Artifact: .agents/context/swift-project-assessment.yaml
```

## Out of scope

- Line-level code review
- Performance profiling / Instruments
- Changing product code (assessment is read-only except the YAML artifact)
- TypeScript / plugin implementation review

## Downstream consumers

| Skill | How it uses this artifact |
| --- | --- |
| `swiftui-architecture-review` | Assumes assessment exists; applies architecture + SwiftUI checks |
| `toby-engineering-standards` | Aligns org rules with recorded conventions |
| `toby-swift-review` | Runs assessment first when stale/missing |

## Related skills

- `toby-swift-review` — full pipeline entrypoint
- `swiftui-architecture-review` — code quality against this context
- `toby-engineering-standards` — repo culture / ownership
- `toby-native-window` — window creation specialist
- `swiftui-expert-skill`, `swiftui-pro` — deep SwiftUI reference libraries (not project context)
