# Review dimensions (quick router)

Load full sibling references only when the dimension applies to the scoped diff.

| Dimension | Assessment field | Primary references |
| --- | --- | --- |
| Architecture fit | `Feature_Boundaries`, `Intentional_Patterns` | this skill §1; `docs/architecture.md` |
| State | `Observation`, `Dependency_Injection` | `swiftui-pro/references/data.md`, `swiftui-expert-skill/references/state-management.md` |
| Views | `Repository_Conventions` design system | `swiftui-pro/references/views.md`, `swiftui-expert-skill/references/view-structure.md` |
| Performance | — | `swiftui-pro/references/performance.md`, `swiftui-expert-skill/references/performance-patterns.md`, `list-patterns.md` |
| Concurrency | `Observation` + MainActor practice | `swiftui-pro/references/swift.md` |
| Navigation / windows | `Navigation` | `swiftui-pro/references/navigation.md`, `swiftui-expert-skill/references/macos-scenes.md`, `macos-window-styling.md`, skill `toby-native-window` |
| Accessibility | — | `swiftui-pro/references/accessibility.md`, `swiftui-expert-skill/references/accessibility-patterns.md` |
| API currency | `Review_Guidance` | `swiftui-pro/references/api.md`, `swiftui-expert-skill/references/latest-apis.md` |

## Severity heuristic

| Severity | Examples |
| --- | --- |
| blocker | Wrong property wrapper ownership; main-actor data race; broken window registration; ForEach identity causing data corruption |
| major | Hot-path body thrash; missing a11y on primary actions; Native code leaking into Features |
| minor | Deprecated color API in touched code; extractable subview on a cold path |
| note | “Large store is intentional for now”; dual store instances documented in assessment |
