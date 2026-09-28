# Toby for macOS: UI kit

A click-through recreation of the macOS 26 window, rebuilt on 2026-09-28 against `apps/toby-app/Sources/TobyApp` at v0.176.0. Open `index.html`. It composes only the system's own components (`window.TobyDesignSystem_28de33`). It follows the system appearance; set `data-theme="light"` or `"dark"` on `<html>` to pin one.

## Screens

| Screen | What it shows | Source |
| --- | --- | --- |
| Window shell | Floating sidebar panel (inset 8px, 18px corners), destination list with Automation and Tools sections, persona footer with status dot; toolbar with glass capsules (back/forward, record/settings/search, refresh) | `Features/Sidebar/AppSidebar.swift`, `SidebarFooter.swift`, `App/RootToolbars.swift` |
| Home | Greeting, hairline-bordered cards with CardSection content, "Continue working" rows, and the Actions inspector rail of colored flow tiles | `Features/Dashboard/DashboardView.swift`, `DashboardCards.swift`, `DashboardActionRunnersRail.swift`, `DashboardRecentWork.swift` |
| Chats | List column of chat rows; transcript with a left-aligned user bubble, the "Worked for" row, a plain SF Pro answer, and the glass InputDock | `Features/Chat/*`, `UI/Primitives/InputDock.swift` |
| Flows | List column of browser rows with "Built-in" badges; detail pane with segmented Details / Recent runs tabs over an inset panel, numbered step cards and the metadata grid | `Features/Flows/FlowDetailContent.swift`, `UI/Primitives/DetailInspect.swift` |

Every other destination shows a one-line placeholder: nothing on those screens is invented.

## Substitutions

Icons are **Lucide** (CDN), standing in for SF Symbols, matched by name to the `systemImage` strings in the Swift source. Liquid Glass is approximated with the `.toby-glass` class (`material-glass`, `material-glass-edge`, `blur-material`, `shadow-glass`); native work uses `.glassEffect()`. The persona portrait is `assets/personas/toby.png`.
