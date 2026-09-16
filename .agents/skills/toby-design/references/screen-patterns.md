# Native screen and window patterns

Use this reference to select composition and ownership. For window/chrome
implementation details, invoke `toby-native-window`.

| Pattern | Canonical source | Rules to preserve |
| --- | --- | --- |
| Main shell | `App/RootView.swift`, `Features/Sidebar/AppSidebar.swift` | `NavigationSplitView` in a standard titled window; no opaque sidebar/toolbar fill; route state/root notifications stay in Root; sidebar is 250pt minimum and owns a stable destination list plus compact persona footer with a server-status indicator. Feature lists belong in the detail workspace via `FeatureWorkspaceSplit` so they sit under the window toolbar separator (same as Chats) instead of flattening into a full-height title-bar column. |
| Dashboard | `Features/Dashboard/DashboardView.swift` | 24pt inset; 320–460pt waterfall cards/20pt gap in a 940pt area; intrinsic cards capped at 340pt when collapsed; combined recent chats/projects participate as a peer card; actions in 120–280pt inspector (156pt default). Reorder state remains persisted but has no Home UI entry point. |
| Chat | `Features/Chat/{ChatWorkspaceView,ChatWorkspaceComponents,TranscriptView}.swift` | Switch between empty and active workspace; measured dock height is transcript padding; 18pt bottom gutter; virtualize long transcripts; autoscroll unless the user has scrolled up from the latest content. |
| Integrations | `Features/Configure/{IntegrationsSettingsView,SettingsCatalogView,ConfigureSectionDetailView}.swift` | Settings catalog tab: grouped Form list, no auto-select. Clicking a plugin pushes a Form detail (`NavigationStack`) while the sidebar stays on Integrations. Deep links use `selectedNavKey`. |
| Settings | `Features/Configure/SettingsWindowView.swift` | Separate preferences window; `NavigationSplitView` sidebar + grouped Form; Integrations and AI are catalog tabs that push child detail; deep links via `selectedNavKey`. |
| Recordings | `Features/Recordings/{RecordingsView,RecordingsDetailView,RecordingDetailContent}.swift` | Account for active capture, processing, error, empty, single detail, and multi-selection. Do not auto-select a saved or in-progress recording. Select a newly started recording; keep the last selection when leaving and returning. Detail uses Summary / Transcript tabs (`selectedDetailTab`). While summarizing, keep existing summary text (or a Summarizing… placeholder) and apply `intelligenceOutline` to the summary card. |
| Skills | `Features/Skills/{SkillsDetailView,SkillDetailContent}.swift` | Branch loading → selected detail → unselected placeholder. Do not auto-select. Detail uses About / Instructions tabs (`selectedDetailTab`); selecting a skill resets to Instructions. |
| Flows | `Features/Flows/{FlowsDetailView,FlowDetailContent}.swift` | Branch loading → selected detail → unselected placeholder. Do not auto-select. Detail uses Details / Recent runs tabs (`selectedDetailTab`); selecting a flow resets to Details. No inspector column — metadata lives on Details. |
| Schedules | `Features/Schedules/{SchedulesDetailView,ScheduleDetailContent}.swift` | Branch loading → selected detail → unselected placeholder. Do not auto-select. Detail uses Details / Prompt tabs (`selectedDetailTab`); selecting a schedule resets to Prompt. Details holds config + recent runs (no card chrome); Prompt holds the markdown body or flow summary. |
| Projects | `Features/Projects/{ProjectsView,ProjectDetailContent}.swift` | Branch loading → selected detail → project chat → unselected placeholder. Do not auto-select. Detail uses Details / Chats tabs (`selectedDetailTab`); selecting a project resets to Details; returning from a project chat opens Chats. Details holds About fields + file tree (no card chrome); no Chats inspector. |
| Feature list | `Features/Sidebar/FeatureBrowser.swift` plus each workspace sidebar | Shared second-sidebar contract: no automatic first-item selection; empty-area click clears selection; unselected detail uses `FeatureBrowserPlaceholder` (select copy, plus a create link when the type can be created); stores keep the last selected id across route changes. |
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
