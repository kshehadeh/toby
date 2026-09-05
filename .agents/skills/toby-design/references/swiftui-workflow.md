# SwiftUI delivery workflow

Use this after visual composition is known.

1. Read `DESIGN.md`, this skill, and the closest existing source counterpart.
2. Use `AppTheme`/`SettingsDesign` and existing primitives. Keep new state in
   the established `@Observable @MainActor` feature store or locally in the view
   according to `screen-patterns.md`.
3. Preserve native controls, accessibility labels/hints/identifiers, keyboard
   paths, focus, loading/error/empty/refresh branches, and Reduce Motion.
4. Add or update focused `ViewInspector` tests under
   `apps/toby-app/Tests/TobyAppTests/`. Mark suites `@MainActor`; use structural
   traversal instead of image accessibility labels for test lookup.
5. Run `bun run test:swift`. Run any narrower relevant build/test command when
   changing stores, models, or AppKit behavior.

## Review questions

- Does the screen use dynamic colors in both appearances?
- Is there exactly one clear prominent primary action?
- Is a native control/pattern available before adding custom chrome?
- Does state ownership avoid duplicate selection/loading/focus truth?
- Can keyboard and VoiceOver users discover and operate every action?
- Does the animation communicate state, respect Reduce Motion, and avoid
  unnecessary layout movement?
