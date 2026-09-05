repo: kshehadeh/toby
branch: main
path: (whole repo; design system built primarily from apps/toby-app and apps/help-site)

## Last visual-reference sync

date: 2026-08-24T00:00:00Z

### Updated in this project

- Extracted the app's color, type, spacing, radius, elevation and motion tokens into `tokens/*.css`.
- Copied the Toby mark, persona portraits, integration and AI-provider icons into `assets/`.
- Authored 26 React component families mirroring the app's SwiftUI primitives.
- Built two UI kits: the macOS app shell and the Docusaurus help site.

### Authority

This is a visual-reference sync record, not a source of truth. For native
implementation, use the current SwiftUI source first, then root `DESIGN.md`.
Figma mappings and known fidelity limits are in `references/figma-map.md`.

## Screen map

| Project screen | Repo files |
| --- | --- |
| `ui_kits/toby-app/index.html` (shell, toolbar) | `apps/toby-app/Sources/TobyApp/App/RootView.swift`, `App/RootToolbars.swift` |
| `ui_kits/toby-app/Sidebar.jsx` | `Features/Sidebar/AppSidebar.swift`, `SidebarHeader.swift`, `SidebarFooter.swift`, `SidebarSessionRow.swift` |
| `ui_kits/toby-app/DashboardScreen.jsx` | `Features/Dashboard/DashboardCards.swift`, `OnboardingCard.swift` |
| `ui_kits/toby-app/ChatScreen.jsx` | `Features/Chat/ChatWorkspaceComponents.swift`, `UserMessageRow.swift`, `AssistantMessageRow.swift`, `TranscriptStepRows.swift`, `UI/Primitives/InputDock.swift` |
| `ui_kits/toby-app/IntegrationsScreen.jsx` | `Features/Integrations/*` |
| `ui_kits/toby-app/SettingsScreen.jsx` | `Features/Configure/AppearanceSettingsView.swift`, `SettingsWindowView.swift`, `UI/SettingsControls/*` |
| `ui_kits/help-site/index.html` | `apps/help-site/src/css/custom.css`, `src/pages/index.tsx`, `src/pages/index.module.css`, `docs/**` |
| `tokens/*.css` | `UI/Theme/NSColor+TobyTheme.swift`, `AppTheme.swift`, `SettingsDesign.swift`, `AppearancePreferences.swift`, `help-site/src/css/custom.css` |
