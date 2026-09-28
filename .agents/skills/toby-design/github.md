repo: kshehadeh/toby
branch: main
path: (whole repo; design system built primarily from apps/toby-app and apps/help-site)

## Last visual-reference sync

date: 2026-09-28T00:00:00Z
ref: main@2f06640 (v0.176.0)

### Updated in this sync

- Retuned the specimens to the macOS 26 app: light-first, Liquid Glass chrome
  (web stand-in in `tokens/primitives.css`), SF Pro answers in a 720px column,
  hairline-bordered Home cards, Actions rail tiles, capsule controls.
- Rewrote 18 of 26 component families from the SwiftUI source and added
  `DetailSection` and `DetailMetadata` (`UI/Primitives/DetailInspect.swift`).
- Rebuilt the six `@dsCard` showcase pages and the `toby-app` UI kit.
- Removed the retired `guidelines/` specimen pages, the `explorations/`
  dashboard mockups, and the old UI-kit screen files.
- Refreshed `_ds_bundle.js`, `_ds_manifest.json` and `_adherence.oxlintrc.json`
  by hand; Claude Design regenerates them on its next sync.

### Authority

This is a visual-reference sync record, not a source of truth. For native
implementation, use the current SwiftUI source first, then root `DESIGN.md`.
Figma mappings and known fidelity limits are in `references/figma-map.md`.

## Screen map

| Project screen | Repo files |
| --- | --- |
| `ui_kits/toby-app/index.html` (window shell, toolbar) | `apps/toby-app/Sources/TobyApp/App/RootView.swift`, `App/RootToolbars.swift`, `Features/Sidebar/{AppSidebar,SidebarFooter}.swift` |
| `ui_kits/toby-app/index.html` (Home) | `Features/Dashboard/{DashboardView,DashboardCards,DashboardBlockChrome,DashboardActionRunnersRail,DashboardRecentWork}.swift` |
| `ui_kits/toby-app/index.html` (Chats) | `Features/Chat/{UserMessageRow,AssistantMessageRow,WorkedForRow,TranscriptMessageActions}.swift`, `UI/Primitives/InputDock.swift` |
| `ui_kits/toby-app/index.html` (Flows) | `Features/Flows/FlowDetailContent.swift`, `Features/Sidebar/{FeatureBrowser,FeatureBrowserRow}.swift`, `UI/Primitives/DetailInspect.swift` |
| `ui_kits/help-site/index.html` | `apps/help-site/src/css/custom.css`, `src/pages/index.tsx`, `src/pages/index.module.css`, `docs/**` |
| `tokens/*.css` | `UI/Theme/NSColor+TobyTheme.swift`, `AppTheme.swift`, `SettingsDesign.swift`, `AppearancePreferences.swift`, `help-site/src/css/custom.css` |
