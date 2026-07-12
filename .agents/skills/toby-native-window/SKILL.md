---
name: toby-native-window
description: >-
  Use when creating or modifying native macOS windows in the Toby app (apps/toby-app/). Covers sidebar windows (Integrations, Schedules, Recordings, Logs), the Settings preferences window (toolbar tabs), modal/sheet-like windows (Changelog, Issue Report), window chrome, and SwiftUI window modifiers.
---

# Toby Native Window Creation

## Goal

Add or modify native macOS windows in the Toby app (`apps/toby-app/`). The app uses SwiftUI's `Window` and `WindowGroup` APIs in `TobyApp.swift`, with two main window patterns.

| Pattern | Examples | Key traits |
| --- | --- | --- |
| **Sidebar window** | Logs (secondary); Integrations / Schedules / Recordings in the main window | `NavigationSplitView` with a sidebar + detail pane. The sidebar toolbar must extend into the title bar so the stoplight appears as part of the sidebar. |
| **Preferences window** | Settings | Separate `Window` with a custom top tab strip (**icon above text**, always visible; scrolls when narrow). Hierarchical sections use a manual `HStack` sidebar + detail (not `NavigationSplitView`/`TabView`, which steal or collapse chrome). |
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

- `apps/toby-app/Sources/TobyApp/App/TobyApp.swift` — window declarations.
- `apps/toby-app/Sources/TobyApp/UI/Platform/WindowAccessor.swift` — helper to access the underlying `NSWindow` for style changes.
- `apps/toby-app/Sources/TobyApp/UI/Theme/AppTheme.swift` — sidebar/content colors and sizing constants.
- `apps/toby-app/Sources/TobyApp/UI/Theme/SettingsDesign.swift` — canvas/card colors used by settings-style views.
- `apps/toby-app/Sources/TobyApp/Features/Sidebar/AppSidebar.swift` — main chat sidebar (different from settings sidebars).
- `apps/toby-app/Sources/TobyApp/Features/Configure/SettingsWindowView.swift` — Settings preferences window (toolbar tabs).
- `apps/toby-app/Sources/TobyApp/Features/Configure/SettingsHierarchySidebarView.swift` — nested section list (e.g. AI providers).

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

## Workflow C — Preferences window (Settings)

1. Register `Window("Settings", id: "settings")` in `TobyApp.swift` with `.windowStyle(.automatic)`, resizable defaults, and `.commandsRemoved()`.
2. Root view (`SettingsWindowView`):
   - Load top-level sections from the configure API / `ConfigureStore.settingsSections`.
   - Use **`SettingsPreferencesTabBar`** (icon above caption). Do **not** use `TabView` — it collapses the tab strip when the window is narrow.
   - **Leaf tabs**: scroll form detail only (`ConfigureDetailView`).
   - **Hierarchical tabs** (e.g. AI): manual `HStack` with `SettingsHierarchySidebarView` + detail. Do **not** use `NavigationSplitView` inside Settings — it replaces window chrome and hides the tab bar. Auto-select the first child when the tab is chosen.
3. Open via `openWindow(id: "settings")` / `OpenWindowBridge` / Cmd+, (`OpenSettingsMenuItem`). Do **not** use a main-window `DetailRoute` for Settings.
4. Deep links set `ConfigureStore` selection (`selectSection` / `selectedNavKey`) then open the window.

## Examples in the codebase

- Preferences window: `SettingsWindowView.swift`, `SettingsHierarchySidebarView.swift`.
- Sidebar windows: `IntegrationsView.swift`, `SchedulesView.swift`, `RecordingsView.swift`, `LogsView.swift`.
- Modal window: `ChangelogView.swift`, `WindowAccessor.swift`.

## Common mistakes

- Forgetting the sidebar toolbar → the stoplight floats above the sidebar with a visible gap.
- Using `.windowStyle(.hiddenTitleBar)` on a sidebar window → the title is hidden and the window does not match the other settings-style windows.
- Removing `.resizable` from a sidebar window → the window becomes fixed-size when it should be resizable.
- Forgetting `.toolbar(removing: .sidebarToggle)` on secondary sidebar windows → the sidebar toggle appears.
- Forgetting `WindowAccessor` on a modal window → the yellow minimize and green maximize buttons remain.
