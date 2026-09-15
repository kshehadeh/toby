---
name: toby-native-window
description: >-
  Use when creating or modifying native macOS windows in the Toby app (apps/toby-app/). Covers sidebar windows (Schedules, Recordings, Logs), the Settings preferences window (Liquid Glass sidebar + grouped Form), modal/sheet-like windows (Changelog, Issue Report), window chrome, and SwiftUI window modifiers.
---

# Toby Native Window Creation

## Goal

Add or modify native macOS windows in the Toby app (`apps/toby-app/`). The app uses SwiftUI's `Window` and `WindowGroup` APIs in `TobyApp.swift`, with two main window patterns.

| Pattern | Examples | Key traits |
| --- | --- | --- |
| **Sidebar window** | Logs (secondary) | `NavigationSplitView` with a sidebar + detail pane. The sidebar toolbar must extend into the title bar so the stoplight appears as part of the sidebar. The main window uses a destination-list sidebar (`AppSidebar`); Schedules / Recordings are detail workspaces. |
| **Preferences window** | Settings | Separate window with a Liquid Glass sidebar + grouped `Form` detail. See `macos-settings-ui`. Do not add a custom icon-over-label tab strip. |
| **Modal / sheet-like window** | Changelog, Issue Report | Fixed-size, non-resizable, only the red close button, traditional macOS title bar. |

## Hard rules

1. **Always declare windows in `apps/toby-app/Sources/TobyApp/TobyApp.swift`.**
2. **Do not paint custom fills on split-view chrome.** macOS 26 Liquid Glass is the sidebar, toolbar, and inspector material. Do **not** apply `AppTheme.sidebarBackground`, `SettingsDesign.canvasBackground`, or `.toolbarBackground(.visible)` to `NavigationSplitView` columns, toolbars, or `.inspector()` panels — those overlays kill system glass.
3. **Main window must** use a standard titled/toolbar window (`.windowStyle(.automatic)` or omit the modifier). Do **not** use `.hiddenTitleBar`; glass wraps concentrically around the traffic lights and toolbar.
4. **Sidebar windows must:**
   - Use `NavigationSplitView` with `.navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 300)` on the sidebar.
   - Remove the sidebar toggle from secondary windows: `.toolbar(removing: .sidebarToggle)` on the sidebar column.
   - Add a toolbar to the sidebar so the sidebar glass extends into the title bar and the stoplight sits on the sidebar. If there is no real sidebar action, add a disabled, clear placeholder button in `.confirmationAction`.
   - Keep the window resizable with a sensible `minWidth`/`minHeight`.
5. **Modal windows must:**
   - Use `.windowStyle(.automatic)` and a traditional title bar.
   - Be non-resizable and remove the minimize/maximize buttons via `WindowAccessor` on the root view: `window.styleMask.remove([.miniaturizable, .resizable])`.
   - Set a fixed default size via `.defaultSize(width:height:)`.
   - Show a loading skeleton while async content loads and cache the content for ~10 minutes with a refresh button in `.primaryAction`.
6. **Window titles**:
   - Sidebar windows show the title in the macOS title bar automatically from the `Window("Title", id: "...")` declaration.
   - Changelog uses a native title bar with a stoplight close button only.
7. **Tests**: add or update `apps/toby-app/Tests/TobyAppTests/<ViewName>Tests.swift` and run `bun run test:swift` before finishing.

## Common files

- `apps/toby-app/Sources/TobyApp/App/TobyApp.swift` — window declarations.
- `apps/toby-app/Sources/TobyApp/UI/Platform/WindowAccessor.swift` — helper to access the underlying `NSWindow` for style changes.
- `apps/toby-app/Sources/TobyApp/UI/Theme/AppTheme.swift` — sidebar/content colors and sizing constants.
- `apps/toby-app/Sources/TobyApp/UI/Theme/SettingsDesign.swift` — canvas/card colors used by settings-style views.
- `apps/toby-app/Sources/TobyApp/Features/Sidebar/AppSidebar.swift` — main destination list + compact persona footer (different from settings sidebars).
- `apps/toby-app/Sources/TobyApp/Features/Configure/SettingsWindowView.swift` — Settings preferences window.
- `apps/toby-app/Sources/TobyApp/Features/Configure/SettingsCatalogView.swift` — catalog tabs (Integrations, AI) that push child detail.

## Workflow A — Sidebar window

1. Add a new `Window("Title", id: "<id>") { ... }` in `TobyApp.swift`:
   - Use `.windowStyle(.automatic)` for a traditional title bar.
   - Set `.defaultSize(width: 920, height: 640)` and `.frame(minWidth: 860, minHeight: 560)` on the root view.
2. Create `<Name>View.swift` with `NavigationSplitView`:
   - Sidebar column: `ScrollView` of selectable items with **no** opaque `AppTheme.sidebarBackground` fill.
   - Detail column: content view; keep solid fills on content, not on the split column itself.
   - Apply `.toolbar(removing: .sidebarToggle)` to the sidebar column.
   - Do **not** apply `.toolbarBackground(.visible)` or an opaque sidebar fill.
   - Add a sidebar toolbar in `SidebarView` (even a disabled clear placeholder) so the sidebar glass extends into the title bar.
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

Tahoe System Settings is a **sidebar** `NavigationSplitView` plus grouped `Form`, not a custom icon-over-label tab strip. Follow `.agents/skills/macos-settings-ui/` for the window chrome (`fullSizeContentView`, transparent form background).

1. Prefer an `NSWindow` with `.fullSizeContentView` when SwiftUI `Window` does not produce glass corners; otherwise keep `Window("Settings", id: "settings")` in `TobyApp.swift` with `.windowStyle(.automatic)`, `.defaultPosition(.center)` (first launch only; later opens restore the saved frame), resizable defaults, and `.commandsRemoved()`.
2. Root view:
   - Load top-level sections from the configure API / `ConfigureStore.settingsSections`.
   - Use `NavigationSplitView` with `.listStyle(.sidebar)` for General, Sync, Personas, Integrations, and daemon sections.
   - Detail panes: `Form { Section { … } }.formStyle(.grouped).scrollContentBackground(.hidden)`.
   - Nested sections (Integrations, AI) are catalog tabs: one sidebar row, child detail pushed in a `NavigationStack`.
   - `SettingsCard` remains valid for in-app settings-style **content** (schedule editor), not for the Settings window itself.
3. Open via `openWindow(id: "settings")` / `OpenWindowBridge` / Cmd+, (`OpenSettingsMenuItem`). Do **not** use a main-window `DetailRoute` for Settings.
4. Deep links set `ConfigureStore` selection (`selectSection` / `selectedNavKey`) then open the window.

Do not add toolbar-tab chrome. New settings belong in the sidebar + grouped Form.

## Examples in the codebase

- Preferences window: `SettingsWindowView.swift`, `SettingsCatalogView.swift`.
- Sidebar windows: `SchedulesView.swift`, `RecordingsView.swift`, `LogsView.swift`.
- Modal window: `ChangelogView.swift`, `WindowAccessor.swift`.

## Common mistakes

- Painting `AppTheme.sidebarBackground` or `.toolbarBackground(.visible)` on a split view → Liquid Glass is covered by an opaque fill.
- Using `.windowStyle(.hiddenTitleBar)` on the main or sidebar windows → traffic lights and toolbar do not sit on glass.
- Forgetting the sidebar toolbar → the stoplight floats above the sidebar with a visible gap.
- Removing `.resizable` from a sidebar window → the window becomes fixed-size when it should be resizable.
- Forgetting `.toolbar(removing: .sidebarToggle)` on secondary sidebar windows → the sidebar toggle appears.
- Forgetting `WindowAccessor` on a modal window → the yellow minimize and green maximize buttons remain.
