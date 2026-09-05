# Native component recipes

Use this reference after reading [`DESIGN.md`](../../../../DESIGN.md). Production
SwiftUI is authoritative; Figma names describe the library catalog.

| Need / Figma family | Native source | Required behavior |
| --- | --- | --- |
| Theme/foundation | `UI/Theme/AppTheme.swift`, `SettingsDesign.swift`, `NSColor+TobyTheme.swift` | Use semantic dynamic colors and constants. Never pin a light/dark RGB in a view. |
| Button / icon button | `UI/SettingsControls/SettingsActionButton.swift`, `SettingsDestructiveButton.swift`; native `Button` elsewhere | One prominent primary action per view; destructive uses role/tint. Label every icon-only action. |
| Badge / chip / progress | `UI/Primitives/InputDock.swift`, feature-local rows | Chips expose removal. Progress reflects actual bounded work; do not use as decoration. |
| Settings card/row/section | `UI/SettingsControls/{SettingsCard,SettingsRow,SettingsSectionHeader}.swift` | Card owns fill/border; rows use 42pt minimum and omit the trailing divider on the last row. Controls keep their native labels and disabled reasons. |
| Select / toggle / field | `UI/SettingsControls/{SettingsSelectField,SettingsToggle,SettingsInlineField}.swift` | Prefer the existing control and native focus/keyboard behavior. Do not make web-style inputs. |
| Inline status | `UI/Primitives/InlineStatusMessage.swift` | Use only success/error local feedback. It combines content for accessibility and supports selectable detail when needed. |
| Toast | `UI/Primitives/{AppToastHost,ToastView}.swift` | Global and ephemeral. Max 420pt; hover pauses its 4s dismissal; one action maximum; progress does not auto-dismiss while active. |
| Sidebar | `Features/Sidebar/{AppSidebar,SidebarHeader,SidebarFooter}.swift` | Use 10×12 inset, selection persistence, 6pt three-column route grid, destination color only in route grid, 600ms delayed hover help. |
| Input dock | `UI/Primitives/InputDock.swift` | Return sends, Shift-Return adds newline, 2–6 lines, support permitted attachments, gauge/unavailable context state, Cancel while loading. |
| Transcript | `Features/Chat/{TranscriptView,UserMessageRow,AssistantMessageRow,TranscriptStepRows}.swift` | User max 520; assistant/work max 640; rounded transcript chrome; assistant long-form prose is serif; preserve incremental scroll behavior. |
| Dashboard card | `Features/Dashboard/{DashboardBlockChrome,DashboardCards}.swift` | Panel, no border, 2pt accent cap, quiet 120pt ghost symbol, 340pt collapsed frame, 40pt fade/36pt Show more overlay. |
| Onboarding/flow runner | `Features/Dashboard/{OnboardingCard,DashboardActionRunnersRail}.swift` | Make setup/action outcomes explicit; preserve dashboard editing/reordering behavior rather than rebuilding cards. |

## Component state minimums

| Component kind | Must consider |
| --- | --- |
| Action | enabled, disabled/reason, destructive confirmation, pending/cancelled result |
| Field/control | value, validation/inline error, disabled, focus, loading/save state |
| List/row | empty, loading, selected, hover, multi-selection where applicable, unavailable |
| Data card | loading/skeleton, nil/unconnected, zero/empty, content, refresh error, expand/collapse |
| Composer/transcript | empty, attachment, sendable, streaming, cancel, context-known/context-unavailable, reader-scrolled-up |

## Avoid

- Local `Color.gray`, fixed `Color.white`, arbitrary radii, and card shadows.
- Generic app-level components that hide a stock macOS `Button`, `Toggle`,
  `TextField`, `Alert`, split view, or inspector.
- A component that has only a visual API, but no defined semantic state,
  accessibility contract, or clear owner.
