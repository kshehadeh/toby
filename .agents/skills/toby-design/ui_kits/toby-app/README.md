# Toby for macOS — UI kit

Click-through recreation of the native SwiftUI app, built from
`toby/apps/toby-app/Sources/TobyApp`. All chrome comes from the design system's
own components (`window.TobyDesignSystem_28de33`); this kit only composes them.

Open `index.html`.

## Screens

| Screen | File | Source |
| --- | --- | --- |
| App shell (sidebar + toolbar) | `Sidebar.jsx`, `index.html` | `Features/Sidebar/AppSidebar.swift`, `SidebarHeader.swift`, `SidebarFooter.swift`, `App/RootToolbars.swift` |
| Home / dashboard | `DashboardScreen.jsx` | `Features/Dashboard/DashboardCards.swift`, `OnboardingCard.swift` |
| Chat (empty + active) | `ChatScreen.jsx` | `Features/Chat/ChatWorkspaceComponents.swift`, `UserMessageRow.swift`, `AssistantMessageRow.swift`, `TranscriptStepRows.swift`, `UI/Primitives/InputDock.swift` |
| Integrations | `IntegrationsScreen.jsx` | `Features/Integrations/*`, `Features/Configure/IntegrationDetailHeader.swift` |
| Settings | `SettingsScreen.jsx` | `Features/Configure/AppearanceSettingsView.swift`, `SettingsWindowView.swift`, `UI/SettingsControls/*` |

## What is interactive

- The 3×3 sidebar grid switches destinations.
- Chat: pick a suggestion or type, press Send → work steps stream, then a serif answer.
- Dashboard: the refresh control swaps the card body for the loading skeleton.
- Integrations: the inner sidebar selects the detail pane.
- Settings → Appearance: theme and accent controls re-theme the whole kit live
  (this is the app's real behavior — accent is a user preference).

## Deliberately blank

Projects, Skills, Memories, Schedules, Flows, and Recordings show their real
one-sentence descriptions from `AppSidebar.swift` plus a note that the surface
is not recreated here. Nothing on those screens is invented.

## Substitutions

Icons are **Lucide** (CDN), standing in for SF Symbols, which have no web
distribution. Names were matched one-to-one with the `systemImage` strings in
the Swift source. Integration and AI-provider icons are the real PNGs copied
from the repo.
