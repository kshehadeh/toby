---
name: toby-design
description: Build or review Toby UI using the source-backed macOS design contract, component recipes, screen patterns, and Figma reference map.
user-invocable: true
---

Use this skill for any Toby visual design, native SwiftUI component, screen, or
prototype task.

## Required workflow for native macOS UI

1. Read the repository-level [`DESIGN.md`](../../../DESIGN.md). It is the
   concise implementation contract.
2. Read only the detailed reference that matches the task:
   - [`references/component-recipes.md`](references/component-recipes.md) for
     primitives, forms, navigation, feedback, chat, and dashboard components.
   - [`references/screen-patterns.md`](references/screen-patterns.md) for an
     app surface, layout, async state, or selection flow.
   - [`references/swiftui-workflow.md`](references/swiftui-workflow.md) before
     implementing or reviewing SwiftUI.
   - [`references/figma-map.md`](references/figma-map.md) when using or
     updating the Toby Design System Figma file.
3. Inspect the closest production SwiftUI counterpart before making a change.
   Production source takes precedence over Figma and documentation if they
   differ.
4. Reuse `AppTheme`, `SettingsDesign`, existing UI primitives, and native macOS
   controls. Do not introduce generic web-style abstractions.
5. Model all relevant loading, empty, unavailable, selected, disabled,
   streaming, error, accessibility, keyboard, focus, and Reduce Motion states.
6. Add or update focused SwiftUI tests and run `bun run test:swift` when
   changing product source.

For windows, title bars, sidebars, Settings, or modal behavior, also invoke
`toby-native-window`. It owns the detailed window implementation rules.

## Prototypes and assets

For throwaway visual artifacts, copy assets out and create static HTML files the
user can view. Treat Figma, the React specimens, tokens, and UI kits here as
reference material; do not assume they encode the full native behavior.

If invoked without a concrete deliverable, ask what the user wants to build and
whether it is production SwiftUI or a prototype.
