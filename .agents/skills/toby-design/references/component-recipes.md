# Native component recipes

Use this reference after reading [`DESIGN.md`](../../../../DESIGN.md). Production
SwiftUI is authoritative; Figma names describe the library catalog.

| Need / Figma family | Native source | Required behavior |
| --- | --- | --- |
| Theme/foundation | `UI/Theme/AppTheme.swift`, `SettingsDesign.swift`, `NSColor+TobyTheme.swift` | Use semantic dynamic colors and constants. Never pin a light/dark RGB in a view. Dock icon is `apps/toby-app/AppIcon.icon`; menu bar uses `toby-menubar` as a template image. |
| Button / icon button | `UI/SettingsControls/SettingsActionButton.swift`, `SettingsDestructiveButton.swift`; native `Button` elsewhere | One prominent primary action per view; destructive uses role/tint. Label every icon-only action. |
| Badge / chip / progress | `UI/Primitives/InputDock.swift`, feature-local rows | Chips expose removal. Progress reflects actual bounded work; do not use as decoration. |
| Settings card/row/section | `UI/SettingsControls/{SettingsCard,SettingsRow,SettingsSectionHeader}.swift` | Card owns fill/border with concentric corners; rows use 42pt minimum and omit the trailing divider on the last row. Controls keep their native labels and disabled reasons. Prefer grouped `Form` in the Settings window. |
| Select / toggle / field | `UI/SettingsControls/{SettingsSelectField,SettingsToggle,SettingsInlineField}.swift` | Prefer the existing control and native focus/keyboard behavior. Do not make web-style inputs. |
| Inline status | `UI/Primitives/InlineStatusMessage.swift` | Use only success/error local feedback. It combines content for accessibility and supports selectable detail when needed. |
| Toast | `UI/Primitives/{AppToastHost,ToastView}.swift` | Global and ephemeral Liquid Glass overlay. Max 420pt; hover pauses its 4s dismissal; one action maximum; progress does not auto-dismiss while active. |
| Intelligence outline | `UI/Primitives/IntelligenceOutline.swift` | Siri-style rainbow ring while AI work is in flight. `.intelligenceOutline(isActive:)` (rounded rect) or `in:` for capsule/circle/custom `Shape`. Fade 0.3s; Reduce Motion snaps; Increase Contrast thickens. Apply after `clipShape`. Decorative (hidden from VoiceOver). Used on dashboard cards (`isUpdating`) and the recording Summary card (`summarizingRecordingId`). |
| Sidebar | `Features/Sidebar/{AppSidebar,SidebarFooter,SidebarConnectionStatus}.swift` | Native `List(selection:)` destinations (primary + Automation + Tools), system glass (no `AppTheme.sidebarBackground` fill), compact persona footer with a persistent status-dot control, labelled connection recovery only when unhealthy. Record browsing lives in feature workspaces, not the global sidebar. |
| Input dock | `UI/Primitives/InputDock.swift` | Return sends, Shift-Return adds newline, 2–6 lines, support permitted attachments, gauge/unavailable context state, Cancel while loading. Floating concentric `.glassEffect`. Send/cancel/attach are native circular/borderless buttons, not painted circles or nested glass. |
| Transcript | `Features/Chat/{TranscriptView,UserMessageRow,AssistantMessageRow,WorkedForRow,TranscriptMessageActions}.swift` | Shared 720pt reading column; left-aligned user well (no accent stripe); unbubbled assistant Markdown in 15pt system sans; collapsed work is a muted `Worked for` caption; copy + relative time under completed messages; preserve incremental scroll behavior. |
| Feature browser | `Features/Sidebar/{FeatureBrowser,FeatureBrowserRow}.swift` | Shared `FeatureWorkspaceSplit` + `FeatureBrowserList` (10pt horizontal inset) + `FeatureBrowserRow` + `FeatureBrowserPlaceholder`. The split is an `HStack` under the window toolbar (not `HSplitView`, which flattens into a full-height title-bar column). Workspace records are rows, not card grids. Rows share a snapped selection wash; do not swap SF Symbol names or use `contentTransition` on select. |
| Entity editor sheet | `UI/Primitives/EditorSheet.swift` | Shared New/Edit chrome: `NavigationStack` with system `navigationTitle` and Cancel/Save as `.cancellationAction` / `.confirmationAction` toolbar items (same as `FlowResultSheet` / `FlowRunDetailView`). Do not draw an in-content headline or footer, set `window.title` via AppKit, or use `.presentationSizing(.fitted)` — those overlap macOS 26 sheet glass. The body fills the remaining space so feature panes can scroll. Escape / Return, optional inline error, dirty discard alert (`Discard Unsaved Changes?`), `.interactiveDismissDisabled` while dirty or saving. Compact ~460×600; flow/schedule editors use `.wide` (~720×760). Present from the feature view when `store.editor != nil` (recordings use a local name draft). Sectioned editors (schedules, skills) use a segmented picker with both panes kept mounted, not `TabView`. |
| Inspect detail rows | `UI/Primitives/DetailInspect.swift` | `DetailHeading` (title2 semibold), `DetailSection` (13pt semibold title + content), `DetailMetadataRow` (label left, value right). 20–22pt section spacing on `SettingsDesign.canvasBackground`. No SettingsCard chrome on the primary inspect pane. |
| Dashboard card | `Features/Dashboard/{DashboardBlockChrome,DashboardCards}.swift` | Content-surface panel (not glass), concentric corners, quiet outline and header divider, shared `intelligenceOutline` while `isUpdating`, intrinsic height capped at 340pt when collapsed, structured sections with compact system typography and Markdown fallback, and fade/Show more only on overflow. |
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

- Local `Color.gray`, fixed `Color.white`, unrelated radii, and card shadows.
- Liquid Glass on content cards, list rows, or form canvases; custom fills on
  split-view sidebars, toolbars, or inspectors.
- Generic app-level components that hide a stock macOS `Button`, `Toggle`,
  `TextField`, `Alert`, split view, or inspector.
- A component that has only a visual API, but no defined semantic state,
  accessibility contract, or clear owner.
