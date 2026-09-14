# Toby macOS design contract

This is the implementation contract for anyone, including an AI agent, creating
or changing UI in `apps/toby-app`. It defines the expected visual language,
behavior, component choices, and delivery checks so a task description does not
need to repeat them.

## Authority and scope

This contract covers **the native macOS app only**. The help site has its own
web design system and is deliberately out of scope.

When guidance differs, use this order:

1. Current production SwiftUI/AppKit source
2. This document
3. The Figma file, **Toby Design System**
4. `.agents/skills/toby-design` visual kits and React specimens

Figma is a reusable catalog, not a second implementation specification. Record
or correct a material Figma mismatch when discovered; do not copy an obsolete
or simplified Figma treatment over production behavior.

Read this file, invoke `toby-design`, and inspect the named source counterpart
before changing native UI. For windows or title-bar chrome, also invoke
`toby-native-window`.

## Fast path for agents

1. Identify the existing screen, layout archetype, and closest component below.
2. Reuse an existing SwiftUI primitive, `AppTheme`, `SettingsDesign`, and stock
   macOS control before creating view-local styling.
3. Model loading, unavailable, empty, populated, selected, disabled, and
   destructive states intentionally. Do not add a happy-path-only view.
4. Preserve keyboard, focus, accessibility, dynamic light/dark color, and
   Reduce Motion behavior.
5. Verify the component and its relevant states in both appearances, then add
   or update focused SwiftUI tests.

Detailed recipes and source maps live in
[`.agents/skills/toby-design/references/`](.agents/skills/toby-design/references/).

---

## 1. Product character

Toby is a spacious, Mac-like personal productivity app. Its neutral surfaces,
small type, restrained ornament, and user-selected accent keep information
quiet and readable.

### Non-negotiables

- Dynamic light and dark palettes are never mixed. Use `AppTheme` or
  `SettingsDesign`, not fixed colors.
- Text and hairlines are alpha over the current surface, never invented opaque
  gray shades.
- One user-selected accent appears at a time. It is an emphasis tool, not a
  decorative palette.
- Keep a two-layer macOS 26 hierarchy: **Liquid Glass** for navigation and
  floating controls; **solid / standard materials** for content. Do not paint
  custom fills on sidebars, toolbars, inspectors, or split-view columns — those
  overlays kill system glass.
- Do not put Liquid Glass on the content layer (lists, dashboard cards,
  transcript bubbles, settings rows, form canvases). Content stays quiet and
  mostly flat: no gradients, photos, texture, decorative cards, or generic drop
  shadows.
- Separate content with whitespace first. A settings card has at most one
  hairline divider per row, and a dashboard card has no border or divider.
- Use SF Symbols, never emoji, for app controls. Use the shipped raster asset
  for integrations, providers, and personas.
- Use sentence case. Uppercase is a visual style for badges, sidebar section
  labels, and work-step metadata, not a copy convention.
- Prefer native macOS behavior over web conventions. No ripple, press-scale,
  synthetic pill tabs, or custom dialog when the platform control is adequate.

### macOS 26 / Liquid Glass

Toby targets macOS 26 (Tahoe). Standard SwiftUI/AppKit bars, split views, and
controls pick up Liquid Glass automatically. Custom chrome should not fight
that.

| Layer | What belongs | Treatment |
| --- | --- | --- |
| Functional | Sidebar, toolbar, inspector, menus, sheets, Input Dock, toast, command palette | System glass, or `.glassEffect` only when the control is custom and floats |
| Content | Transcript, dashboard cards, lists, settings forms, media | Solid `AppTheme` / `SettingsDesign` surfaces. Never `.glassEffect` |

- Remove custom backgrounds on `NavigationSplitView` columns, toolbars, and
  `.inspector()` panels. Do not use `.toolbarBackground(.visible)` to force an
  opaque title bar.
- Use a standard titled window (not `.hiddenTitleBar`) so glass wraps
  concentrically around the traffic lights and toolbar.
- Group related toolbar items (`ToolbarItemGroup`) and separate groups with
  `ToolbarSpacer`. Hide whole items rather than leaving empty bezels.
- Apply `.glassEffect` / `GlassEffectContainer` only to custom floating
  controls (Input Dock, toast, command palette). Do not stack glass on glass.
- Nested rounded shapes should be concentric with their container
  (`ConcentricRectangle`) rather than an unrelated private radius scale.
- Test Reduce Transparency, Increase Contrast, Reduce Motion, and inactive
  windows. System glass adapts; custom glass must too.

### Voice

Write like a competent colleague. State the action and its cost without sales
language or cheerleading.

- Refer to Toby in the third person: “Toby can read and send mail for this
  account,” not “I can…”.
- Empty states name the next meaningful action: “Waiting for daemon”,
  “Connect an email account to see unread mail,” or “No due date”.
- Suggestions are specific, verb-first user speech.
- Reuse fixed status terms: **Connected, Connecting…, Disabled, Idle, Error,
  Unknown, Completed, Overdue, Due today, Due tomorrow**.
- Keep numbers quiet (`2 of 6 done`, `×3`, `1.4s`). Use typographic ellipses in
  new copy (`Connecting…`).

---

## 2. Foundations

### Theme and color

Use dynamic values from
`UI/Theme/{NSColor+TobyTheme,AppTheme,SettingsDesign}.swift`.

| Semantic role | Light | Dark | Use |
| --- | --- | --- | --- |
| Sidebar | `#f2f2f5` | `#1f2426` | Token only — do **not** fill split-view or inspector columns; system glass provides the sidebar |
| Content | `#fcfcfc` | `#141414` | Chat/main content |
| Panel | `#f0f0f2` | `#262626` | Dashboard blocks, wells |
| Elevated | `#f7f7fa` | `#2e2e2e` | Floating chrome |
| Settings canvas | `#f5f5f7` | `#1a1a1c` | Settings-style detail |
| Settings card | `#ffffff` | `#29292b` | Forms and inspector cards |
| Primary text | black/88% | white/88% | Main labels and answers |
| Secondary text | black/55% | white/58% | Supporting text |
| Tertiary text | black/38% | white/38% | Quiet chrome |
| Separator | black/10% | white/8% | Hairlines |

`AppTheme.accent` resolves the user preference. Default orange is `#f59e1f`;
the other supported presets are blue `#408cf2`, green `#40bf73`, purple
`#9e6bf2`, pink `#eb66a6`, red `#e65959`, teal `#33b8b8`, and gray `#8c949e`.
Tint an accent with opacity: 16–18% for hover/own-hue wash, 22% for selected,
and never by inventing another hue.

Use `InlineStatusMessage` for local success/error feedback. Its dynamic green
and red background, border, and foreground colors are semantic values, not
general-purpose decoration.

### Typography

| Role | Treatment |
| --- | --- |
| Standard chrome | System/SF Pro, generally 13pt |
| Titles | System semibold, 17–26pt only where the screen already uses that hierarchy |
| Settings row title | 13pt semibold |
| Row/meta/caption | 11–13pt system, secondary or tertiary text |
| Assistant answer | 15pt serif, 7pt extra line spacing |
| Transcript/steps | Rounded system type |
| Work-step metadata | 10.5pt medium rounded, uppercase, 0.735pt tracking |
| Logs, paths, JSON | SF Mono/system monospaced |

The serif answer is intentional. Use it only for Toby-authored long-form prose
and its summaries, not buttons, labels, settings, or user messages.

### Geometry

Prefer concentric corner radii that follow the window or container
(`ConcentricRectangle`) over a private radius catalog. When matching an
existing content component, preserve its values rather than forcing a
four-point grid.

| Token/pattern | Value |
| --- | --- |
| Content inset | 24 |
| Sidebar inset | 10 horizontal × 12 vertical |
| Dashboard card | 340 collapsed height, 26 inset, 20 grid gap; concentric, minimum 16 |
| Settings card / row | concentric, minimum 10; 42 minimum row height, 10 × 8 row inset |
| General floating card/dock/toast | concentric, minimum 16 |
| Bubble | concentric, minimum 14; 16 × 12 inset |
| Browse/index card | concentric, minimum 10 |
| Tile | concentric, minimum 12; 14 inset |
| Row/button | 8–9 radius |
| Standard control | 6 radius, 24 height |
| Main sidebar | Native `List(selection:)` with `.sidebar` style; 250pt minimum. Destinations only — not a recents feed. Compact persona footer. |

Flat content cards have no shadow. The Input Dock, toast, and command palette
are floating functional chrome: use `.glassEffect` (regular, interactive where
the control is tappable) instead of an opaque fill plus drop shadow. Never
promote glass to content cards.

### Icon and asset rules

Use SF Symbols by semantic name at medium or semibold, usually 10–18pt. Mark
decorative symbols `accessibilityHidden(true)`. Use shipped image assets rather
than redrawing integration/provider/persona marks.

The Dock icon is the Icon Composer document `apps/toby-app/AppIcon.icon`
(layered Liquid Glass: orange fill, cream glass bubble, navy portrait; dark and
tinted specializations). `toby-128.png` is the in-app header mark. `toby-menubar.png`
is a template speech-bubble glyph for the status item (`isTemplate = true`).

---

## 3. Reusable components

### Selection rule

| Need | First choice |
| --- | --- |
| App-wide color/spacing/type | `AppTheme` or `SettingsDesign` |
| Settings form | `UI/SettingsControls/*` |
| Composer, toast, status, copy/reveal action | `UI/Primitives/*` |
| Markdown, rich answer, file/image/table | `UI/Markdown/*` |
| Navigation, dashboard, transcript, detail pane | Existing feature-family view |
| Alert, menu, file importer, split view, inspector | Native SwiftUI/AppKit API |

Do not create a generic `Button`, `Card`, `Tab`, `Avatar`, `Tooltip`, or
`Dialog` abstraction merely to match a Figma layer. Toby deliberately uses
stock controls and focused feature components where the platform already
provides semantics.

### Catalog

The Figma library and `toby-design` kit catalog these families. The native
source path and behavior, not the Figma geometry, define their contract.

| Family | Components and intended behavior |
| --- | --- |
| Core | **Button**: bordered/default, prominent single primary action, plain accent text, destructive. **Icon button**: 26pt target where used, labelled. **Badge/Chip**: quiet compact metadata; chip can remove an attachment. **Progress**: communicate bounded work only. |
| Settings forms | **SettingsCard** owns card fill/border. **SettingsRow** owns 42pt minimum height and optional final-divider omission. **SectionHeader**, select, inline field, toggle, action/destructive buttons use the existing controls. |
| Feedback | **InlineStatusMessage** is persistent local success/error feedback. **Toast** is global, transient feedback; it pauses its 4s timer on hover and may offer one action. **Skeleton** preserves the eventual layout while loading. |
| Navigation | **Destination list** (`List(selection:)` + `.sidebar`) is the global sidebar: Home, Chats, Projects, Recordings, then Automation (Schedules, Flows) and Tools (Skills, Integrations). System selection, semantic secondary icon tint, no per-category colors or timestamps. **PersonaFooter** is a single-line persona control; model name lives in the picker popover. Connection recovery is labelled and hidden when healthy. |
| Chat | **InputDock** owns send/cancel, attachments, context gauge, keyboard return handling, focus, and floating Liquid Glass geometry. **UserMessage**, **AssistantMessage**, and **WorkStepRow** keep transcript roles visually distinct. |
| Dashboard | **DashboardCard** is flat with a 2pt accent cap and ghost glyph. **CardSection** holds uppercase metadata plus answer-like prose. **Flow runner** presents actions. **OnboardingTile** makes an explicit setup action available. |

See the full anatomy, states, source mapping, and “do/don’t” guidance in
[`component-recipes.md`](.agents/skills/toby-design/references/component-recipes.md).

### Creating a new reusable component

Create a component only when all are true:

1. A behavior and visual shape recur in at least two product contexts, or a
   native platform component cannot meet a real product requirement.
2. It owns stable semantics, accessibility, states, and a source-backed token
   contract, not only convenience styling.
3. Its owner is clear: generic primitives in `UI/Primitives`, settings controls
   in `UI/SettingsControls`, or a feature-local component in that feature.
4. It has focused ViewInspector coverage for its meaningful branches.

Otherwise compose existing primitives locally. Document the new component here,
add it to the Figma catalog when it is library-worthy, and update the
`toby-design` source map in the same change.

---

## 4. State and behavior contract

Every feature must deliberately model these applicable states:

| State | Required treatment |
| --- | --- |
| Initial loading | Preserve the shell. Use a spinner for a simple full-view wait or a shape-matched skeleton when content geometry is known. |
| Refreshing | Keep existing content visible; scope the progress indicator to the control/card doing work. |
| Unavailable | Use `ContentUnavailableView` for a whole surface; include a readable cause and recovery action where one exists. |
| Empty | Explain the next action, not merely that a list has zero rows. |
| Selected | Global sidebar rows use the system selected-row treatment (including inactive-window). Do not paint `AppTheme.selection` or accent washes on destination rows. Feature lists in content may keep their existing selection recipe. Do not rely on hover to communicate current selection. |
| Hover | Use the existing neutral or own-hue wash and text promotion. Do not change layout or add a press-scale. |
| Disabled | Keep the control visible but use the component’s muted treatment and supply a useful help/accessibility explanation when the reason is non-obvious. |
| Streaming / in progress | Keep the current response/work step visible, expose Cancel when cancellation is meaningful, and avoid resetting scroll or focus. |
| Success / error | Use an inline status for local durable feedback, a toast for an ephemeral app-wide result, and a native alert before destructive action. |
| Multi-selection | Preserve selection context and provide a summary/deck rather than pretending one item is active. |

State belongs in an `@Observable @MainActor` store when it represents
feature/app data or async lifecycle. A view owns only presentation state such as
hover, local focus, an animation flag, or temporary geometry measurement. Root
owns global bootstrap, windows, sheets, alerts, routes, and global toast routing.

### Input, keyboard, focus, and scrolling

- Use `@FocusState` and request focus only when the workflow requires it.
- The composer supports Return to submit and Shift-Return for a newline. It
  accepts two to six text lines and is disabled while a turn is loading.
- Preserve native keyboard navigation in lists, menus, `NavigationSplitView`,
  alerts, and controls.
- A transcript reserves measured space for its floating composer. Autoscroll
  only when the user is near the bottom; never pull a reader away from older
  content.
- A command palette must support Up/Down selection, Return activation, and
  Escape dismissal.

### Accessibility

- Give interactive controls a spoken label, and a concise hint where the outcome
  is not apparent. Prefer stable `accessibilityIdentifier`s on automation/test
  targets.
- Hide decorative imagery. Combine inline status content into a coherent
  accessibility element.
- Preserve visible focus and minimum target dimensions already used by the
  component. Do not replace semantic `Button`, `Toggle`, `TextField`, list, or
  alert controls with unlabelled gestures.
- Read `accessibilityReduceMotion` before optional, repeating, or spatial
  animation. The existing app is not yet perfectly consistent, so new work must
  improve, not extend, that inconsistency.

### Motion

Default motion is brief and quiet: hover transitions are about 120–150ms and
disclosure is 200ms ease-in-out. Do not add bounce, ripple, or decorative
movement.

Damped springs are an explicit exception used for toast arrival and dashboard
section insertion/removal. Attention may use a small 1.03 persona scale,
recording pulse, or symbol effect only to communicate an active state. Respect
Reduce Motion and keep animation tied to a meaningful state change.

---

## 5. Layout archetypes

Choose an existing archetype instead of inventing a one-off shell.

| Archetype | Contract |
| --- | --- |
| Main app shell | `NavigationSplitView` in a standard titled window: sidebar is a stable destination list plus compact persona footer on system glass (no custom fill); detail owns the selected workspace. Back/Forward sit with the sidebar toggle. The selected item name or section title is the system `navigationTitle` (activity as `navigationSubtitle`) so trailing actions can pin to the window edge. Record, Settings, and labeled Search form the permanent `.primaryAction` group (plus Update when available). Contextual actions are a `ControlGroup` in `.confirmationAction` so they stay a second trailing cluster; omit that item when empty. Sibling `Button`s in `.primaryAction` or `.automatic` merge into one bezel. |
| Dashboard | 24pt content inset, greeting, optional onboarding, adaptive cards (280pt minimum item width/20pt gap), optional resizable actions inspector. Cards remain aligned at 340pt collapsed height. Home has no recent-item list in the global sidebar. |
| Chat workspace | Shared `FeatureWorkspaceSplit`: conversation list beside the transcript when the detail column is wide; list **or** transcript at narrow widths, with an explicit return-to-chats control. Empty workspace centers persona/greeting/dock/suggestions. Active workspace stacks a virtualized transcript behind a bottom-pinned dock, with 18pt bottom gutter and measured transcript reservation. User content maxes at 520pt, assistant/work content at 640pt. |
| Settings-style detail | Settings canvas with left-aligned form content normally capped at 640pt. Settings cards use standard rows and hairlines. |
| Browse and inspect | Same `FeatureWorkspaceSplit` as Chats: a second list column (`FeatureBrowserList`, 10pt horizontal inset) plus selected detail, both under the window toolbar separator. Unselected detail is `FeatureBrowserPlaceholder` (type icon + select/create copy). Do not use card-grid overviews. Preserve trailing inspectors (project files/chats). |
| Preferences window | Separate Settings window: `NavigationSplitView` sidebar + grouped `Form` detail. Hierarchical sections (e.g. AI providers) are sidebar children. Do not add a custom icon-over-label tab strip. |
| Command palette | Spotlight-like 560 × 420 floating `NSPanel`; keyboard-first, transparent surround, rounded card, dismissal on Escape, click-away, and deactivation. |
| Modal/sheet | Native sheet/alert unless an existing dedicated window pattern applies. Destructive work states the consequence and offers Cancel plus destructive action. |

For composition, window registration, dimensions, and state flows, use
[`screen-patterns.md`](.agents/skills/toby-design/references/screen-patterns.md).

---

## 6. Figma relationship

**Toby Design System** mirrors:

- `01 Foundations`: color, typography, spacing, radius, elevation, motion
- `02 Components`: named native component families and Button/Badge variants
- `03 App layouts`: dashboard, chat, integrations, and settings references

Figma Variables include `Toby / Color / Light`, `Toby / Color / Dark`,
`Toby / Accent`, and `Toby / Dimensions`. Its reference screens may use vector
groups or simplified composition; they do not replace SwiftUI layout, state, or
accessibility behavior. The explicit mapping and known limitations are in
[`figma-map.md`](.agents/skills/toby-design/references/figma-map.md).

---

## 7. Delivery checklist

Before completing a native UI task, confirm:

- [ ] Production source and this contract agree; mismatches are resolved in
      favor of source or documented.
- [ ] Existing theme values, primitives, and platform controls were reused.
- [ ] Light and dark dynamic colors both render correctly.
- [ ] The appropriate loading, refresh, empty, unavailable, disabled, selected,
      hover, success/error, and destructive branches exist.
- [ ] Copy, SF Symbols/assets, typography, hierarchy, spacing, and shadows
      match this contract and the closest source counterpart.
- [ ] Keyboard, focus, scrolling, accessibility labels/hints/identifiers, and
      Reduce Motion behavior are preserved.
- [ ] State ownership follows the feature store/view/root boundary.
- [ ] A focused SwiftUI test is added or updated, and `bun run test:swift` is
      run for source changes.
- [ ] The Figma catalog/source map is updated if a reusable component or
      library-worthy behavior changed.
