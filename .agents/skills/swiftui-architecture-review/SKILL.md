---
name: swiftui-architecture-review
description: >
  Review SwiftUI/macOS code in apps/toby-app for architecture fit, state correctness,
  performance, concurrency, navigation, accessibility, and maintainability. Assumes
  Project Assessment context already exists. Use when reviewing SwiftUI changes,
  PRs, or anti-patterns, or when the user runs /swiftui-architecture-review.
  Does not rediscover monorepo structure or enforce org-specific file-size/naming rules.
---

# SwiftUI Architecture & Anti-Pattern Review

## Goal

Answer **whether this code is correct and well-structured as SwiftUI**, given the project’s
established architecture. Focus on framework expertise and architecture fit — not on
rediscovering the repository and not on org culture rules.

## Prerequisite: Project Assessment

**Assume the Project Assessment has already been completed.**

1. Load `.agents/context/swift-project-assessment.yaml`.
2. If missing or `assessed_at` older than 30 days, **stop and run `swift-project-assessment`**
   (or tell the user to run `/swift-project-assessment`), then continue.
3. Obey `Review_Guidance.Prefer`, `Ignore`, and `Validate_Against` from the artifact.
   Do **not** spend tokens re-mapping folder layout, Package.swift, or monorepo ownership.

Org/repo culture (file length caps, naming consistency, ownership matrices, logging policy)
belongs to **`toby-engineering-standards`**, not this skill.

## Operating rules

- Report **genuine problems only** — no nitpicks, no invented issues, no style prefs outside
  architecture and SwiftUI correctness.
- Respect intentional patterns recorded in the assessment (e.g. dual ConfigureStore, AppKit
  for menu bar, custom Settings tabs).
- Prefer native SwiftUI; AppKit only where the assessment marks it intentional (windows,
  menu bar, native bridges).
- Do not mandate VIPER, TCA, or other architectures not used by this project.
- For deep topic detail, **load sibling references** instead of inlining encyclopedias:
  - `.agents/skills/swiftui-pro/references/{data,views,navigation,performance,accessibility,api,swift,design,hygiene}.md`
  - `.agents/skills/swiftui-expert-skill/references/{state-management,view-structure,performance-patterns,list-patterns,accessibility-patterns,macos-scenes,macos-window-styling,macos-views,latest-apis,sheet-navigation-patterns}.md`
- Window chrome / `Window` registration → defer to **`toby-native-window`** findings style;
  flag violations of those hard rules when reviewing window-related diffs.
- Liquid Glass / brand-new platform APIs only when relevant and `#available`-gated.

## Scope selection

| User intent | Scope |
| --- | --- |
| “Review my changes” / uncommitted work | `git diff` limited to `apps/toby-app/**/*.swift` |
| PR / branch | Diff against base for `apps/toby-app` |
| “Review Chat” / a feature | That feature folder + its store + tests |
| Full audit | Feature-by-feature; still do not re-assess the whole monorepo |

Skip non-Swift paths. Skip pure docs unless they contradict implemented architecture.

## Review dimensions

Work through only dimensions that apply to the scoped files. Load the matching reference
file when unsure.

### 1. Architecture fit

- Does the change respect feature boundaries (`Features/`, `Stores/`, `UI/`, `Native/`)?
- Are new types landing in the right layer?
- Does UI talk to the daemon via `TobyClient` rather than reimplementing harness logic?
- Are native/TCC operations confined to `Native/`?
- Does state ownership match the project pattern (`@Observable` store, injection from parent)?

### 2. State & data flow

Use assessment `Observation` + `swiftui-pro/references/data.md` and
`swiftui-expert-skill/references/state-management.md`.

Hard bugs (always report):

- `@State` / `@StateObject` on **passed-in** values (stale, ignores updates)
- `@State` properties that are not `private` when they should be view-owned
- `@Binding` used when read-only would do; missing `@Bindable` for injected `@Observable` needing bindings
- Storing view-invalidating work in the wrong layer (e.g. networking side effects in `body`)

### 3. View structure & maintainability

- Overlarge `body` that should extract subviews (suggest extraction; do not demand arbitrary line quotas — that’s engineering-standards)
- View logic that belongs in the store or a pure helper
- Modifier order / incorrect container choices that break layout
- See `swiftui-pro/references/views.md`, `swiftui-expert-skill/references/view-structure.md`

### 4. Performance

- Unstable `ForEach` identity (`.indices`, ids derived from mutable display text)
- Heavy work in `body`; redundant subscriptions; missing view extraction on hot paths
- Lists that should be lazy; images without reasonable sizing
- Present as **suggestions** unless clearly a bug (e.g. identity thrash)
- See performance references in both sibling skills

### 5. Concurrency

- `@MainActor` isolation consistent with UI/stores
- `Task` lifetimes; cancellation on disappear where needed
- No unprotected cross-actor mutation; prefer structured concurrency
- See `swiftui-pro/references/swift.md`

### 6. Navigation & windows

- Correct use of `NavigationSplitView` / path-based navigation for the feature
- Sheets, alerts, confirmation dialogs used appropriately
- New windows follow **`toby-native-window`** (registration in `TobyApp.swift`, sidebar toolbar, modal style masks)
- Do not recommend `TabView` for Settings if assessment says custom tabs are intentional

### 7. Accessibility

- Icon-only controls have labels; meaningful traits; Dynamic Type where text is user content
- Reduce Motion sensitivity for decorative animation
- Don’t fail the review solely for missing a11y on purely decorative non-interactive chrome
- See accessibility references in sibling skills

### 8. API currency (scoped)

- Soft-deprecated SwiftUI APIs in **touched** code only (e.g. `foregroundColor` → `foregroundStyle`)
- Do not drive-by migrate unrelated files
- See `swiftui-pro/references/api.md`, `swiftui-expert-skill/references/latest-apis.md` and `soft-deprecation.md`

## Out of scope (hand off)

| Concern | Owner |
| --- | --- |
| File length limits, naming matrices, module ownership policy | `toby-engineering-standards` |
| Commit message / PR process | `atomic-conventional-commit` |
| Help site / docs sync | `toby-docs` |
| Instruments `.trace` capture | `swiftui-expert-skill` trace workflows |
| Project context rediscovery | `swift-project-assessment` |

## Output format

Organize by file. For each issue:

1. **File:line** (or range)
2. **Dimension** (Architecture / State / Performance / Concurrency / Navigation / A11y / API)
3. **Rule** in one sentence
4. **Why it matters** in one sentence (tie to assessment when architectural)
5. **Before/after** sketch when a fix is clear

Severity labels:

- **blocker** — correctness, data loss, isolation violation, broken navigation
- **major** — likely perf/a11y/architecture regression
- **minor** — localized improvement
- **note** — intentional tension or follow-up (not a demand)

End with:

### Summary

1. Highest-impact fixes first (blocker → major)
2. What was **explicitly not** flagged because of assessment `Ignore` guidance (1–3 bullets)
3. Whether `toby-engineering-standards` should also run (yes if large structural churn)

Skip files with no issues. If the scoped diff is clean, say so explicitly.

## Example finding

### Sources/TobyApp/Features/Chat/TranscriptView.swift

**Line 88 — State (blocker)**  
Passed-in store declared as `@State` — parent updates will be ignored.

```swift
// Before
struct TranscriptView: View {
    @State var store: ChatStore
}

// After
struct TranscriptView: View {
    var store: ChatStore  // @Observable; use @Bindable only if bindings needed
}
```

## Workflow checklist

- [ ] Loaded assessment YAML; guidance applied
- [ ] Scoped files identified
- [ ] Relevant reference files loaded (not all)
- [ ] Findings limited to genuine issues
- [ ] Summary includes ignored-advice notes
- [ ] Engineering-standards handoff mentioned if needed
