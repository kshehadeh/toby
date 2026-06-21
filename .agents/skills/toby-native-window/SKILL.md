---
name: toby-native-window
description: >-
  Use when creating or modifying native macOS windows in the Toby app (apps/toby-app/). Covers sidebar windows (Integrations, Schedules, Recordings, Settings), modal/sheet-like windows (Changelog, Issue Report), window chrome, and SwiftUI window modifiers.
---

# Toby Native Window Creation

## Goal

Add or modify native macOS windows in the Toby app (`apps/toby-app/`). The app uses SwiftUI's `Window` and `WindowGroup` APIs in `TobyApp.swift`, with two main window patterns.

| Pattern | Examples | Key traits |
| --- | --- | --- |
| **Sidebar window** | Integrations, Schedules, Recordings, Settings | `NavigationSplitView` with a sidebar + detail pane. The sidebar toolbar must extend into the title bar so the stoplight appears as part of the sidebar. |
| **Modal / sheet-like window** | Changelog, Issue Report | Fixed-size, non-resizable, only the red close button, traditional macOS title bar. |

## Hard rules

1. **Always declare windows in `apps/toby-app/Sources/TobyApp/TobyApp.swift`.**
2. **Sidebar windows must:**
   - Use `NavigationSplitView` with `.navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 300)` on the sidebar.
   - Remove the sidebar toggle from secondary windows: `.toolbar(removing: .sidebarToggle)` on the sidebar column.
   - Add a toolbar to the sidebar so the sidebar background extends into the title bar and the stoplight sits on the sidebar. If there is no real sidebar action, add a disabled, clear placeholder button in `.confirmationAction` (see `IntegrationsSidebarView` for the reference pattern).
   - Apply `.toolbarBackground(.visible)` to the `NavigationSplitView` so the title bar is active and consistent with the other sidebar windows.
   - Keep the window resizable with a sensible `minWidth`/`minHeight`.
3. **Modal windows must:**
   - Use `.windowStyle(.automatic)` and a traditional title bar.
   - Be non-resizable and remove the minimize/maximize buttons via `WindowAccessor` on the root view: `window.styleMask.remove([.miniaturizable, .resizable])`.
   - Set a fixed default size via `.defaultSize(width:height:)`.
   - Show a loading skeleton while async content loads and cache the content for ~10 minutes with a refresh button in `.primaryAction`.
4. **Window titles**:
   - Sidebar windows show the title in the macOS title bar automatically from the `Window("Title", id: "...")` declaration.
   - Changelog uses a native title bar with a stoplight close button only.
5. **Tests**: add or update `apps/toby-app/Tests/TobyAppTests/<ViewName>Tests.swift` and run `bun run test:swift` before finishing.

## Common files

- `apps/toby-app/Sources/TobyApp/TobyApp.swift` — window declarations.
- `apps/toby-app/Sources/TobyApp/WindowAccessor.swift` — helper to access the underlying `NSWindow` for style changes.
- `apps/toby-app/Sources/TobyApp/AppTheme.swift` — sidebar/content colors and sizing constants.
- `apps/toby-app/Sources/TobyApp/SettingsDesign.swift` — canvas/card colors used by settings-style views.
- `apps/toby-app/Sources/TobyApp/AppSidebar.swift` — main chat sidebar (different from settings sidebars).

## Workflow A — Sidebar window

1. Add a new `Window("Title", id: "<id>") { ... }` in `TobyApp.swift`:
   - Use `.windowStyle(.automatic)` for a traditional title bar.
   - Set `.defaultSize(width: 920, height: 640)` and `.frame(minWidth: 860, minHeight: 560)` on the root view.
2. Create `<Name>View.swift` with `NavigationSplitView`:
   - Sidebar column: `ScrollView` with `AppTheme.sidebarBackground`, list of selectable items.
   - Detail column: content view with `SettingsDesign.canvasBackground` or `AppTheme.contentBackground`.
   - Apply `.toolbar(removing: .sidebarToggle)` to the sidebar column.
   - Apply `.toolbarBackground(.visible)` to the `NavigationSplitView`.
   - Add a sidebar toolbar in `SidebarView` (even a disabled clear placeholder) so the sidebar extends into the title bar.
3. Add a store/model if the window needs one.
4. Add tests and run `bun run test:swift`.

## Workflow B — Modal / sheet-like window

1. Add a new `Window("Title", id: "<id>") { ... }` in `TobyApp.swift`:
   - Use `.windowStyle(.automatic)`.
   - Set a fixed `.defaultSize(width:height:)`.
2. Create the root view with:
   - A loading skeleton state shown while async content loads.
   - A refresh toolbar item in `.primaryAction`.
   - A `WindowAccessor` background that removes `.miniaturizable` and `.resizable` from the style mask.
   - A `ChangelogStore`-style cache with a `cacheInterval` and `force` parameter.
3. Add tests and run `bun run test:swift`.

## Examples in the codebase

- Sidebar windows: `IntegrationsView.swift`, `SchedulesView.swift`, `RecordingsView.swift`, `ConfigureView.swift`.
- Modal window: `ChangelogView.swift`, `WindowAccessor.swift`.

## Common mistakes

- Forgetting the sidebar toolbar → the stoplight floats above the sidebar with a visible gap.
- Using `.windowStyle(.hiddenTitleBar)` on a sidebar window → the title is hidden and the window does not match the other settings-style windows.
- Removing `.resizable` from a sidebar window → the window becomes fixed-size when it should be resizable.
- Forgetting `.toolbar(removing: .sidebarToggle)` on secondary sidebar windows → the sidebar toggle appears.
- Forgetting `WindowAccessor` on a modal window → the yellow minimize and green maximize buttons remain.
