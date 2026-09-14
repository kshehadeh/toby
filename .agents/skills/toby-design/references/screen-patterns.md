# Native screen and window patterns

Use this reference to select composition and ownership. For window/chrome
implementation details, invoke `toby-native-window`.

| Pattern | Canonical source | Rules to preserve |
| --- | --- | --- |
| Main shell | `App/RootView.swift`, `Features/Sidebar/AppSidebar.swift` | `NavigationSplitView` in a standard titled window; no opaque sidebar/toolbar fill; route state/root notifications stay in Root; sidebar is 250pt minimum and owns status/workspace menu/persona footer. |
| Dashboard | `Features/Dashboard/DashboardView.swift` | 24pt inset; adaptive 280pt cards/20pt gap; 940pt card area; 340pt collapsed cards; actions in 120–280pt inspector (156pt default); reordering only during edit mode. |
| Chat | `Features/Chat/{ChatWorkspaceView,ChatWorkspaceComponents,TranscriptView}.swift` | Switch between empty and active workspace; measured dock height is transcript padding; 18pt bottom gutter; virtualize long transcripts; autoscroll unless the user has scrolled up from the latest content. |
| Integrations | `Features/Integrations/{IntegrationsDetailView,IntegrationDetailContent}.swift` | Branch loading → unavailable → selected detail → home. Home is 240–360pt adaptive cards, 16pt gap, 980pt cap. Preserve detail/inspector selection. |
| Settings | `Features/Configure/SettingsWindowView.swift` | Separate preferences window; `NavigationSplitView` sidebar + grouped Form; hierarchical sections (AI providers) are sidebar children; deep links via `selectedNavKey`. |
| Recordings | `Features/Recordings/{RecordingsView,RecordingsDetailView,RecordingDetailContent}.swift` | Account for active capture, processing, error, empty, single detail, and multi-selection. Auto-select an active recording when applicable. |
| Command palette | `Features/CommandPalette/{CommandPaletteView,CommandPalettePanelController}.swift` | 560×420 floating nonactivating panel on Liquid Glass; deferred focus; Up/Down/Return/Escape; dismiss on resign/deactivation; save only a visible-screen origin. |

## Ownership and async

- `@Observable @MainActor` stores own loaded data, selected IDs, requests, and
  error/loading state.
- A feature `.task` loads its data and flushes deferred saves on disappearance
  where the existing feature does so.
- Root owns parallel bootstrap/refresh work, global toasts, global sheets and
  alerts, route changes, and cross-feature refreshes.
- Keep stale content during refresh. Do not blank a whole screen for a local
  refresh failure.
