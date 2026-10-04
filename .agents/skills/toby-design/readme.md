# Toby Design System

Toby is an AI-assisted **native macOS app and CLI for personal productivity**.
> **For agents building native UI:** start with the repository's
> [`DESIGN.md`](../../../DESIGN.md), then follow this skill's
> [`SKILL.md`](SKILL.md). This bundle is a detailed visual reference; current
> SwiftUI source remains authoritative when it differs from a Figma or React
> specimen.

It connects Email, Todoist, Slack, Jira, Notion, Apple Calendar / Reminders /
Contacts, web search and local macOS controls, so you can search, summarize,
organize and act on work from chat. Around chat it adds personas, skills,
memories, schedules, daemon-run flows, and a local "listen" mode that records
and transcribes audio on-device.

The product's design goal, in the maintainer's words, is to be **as Mac-like as
possible**: light/dark that follows the system, a user-selectable accent color,
and layouts that stay *spacious, never busy*.

## Products represented

| Surface | What it is | Design source |
| --- | --- | --- |
| **Toby for macOS** | The main product. SwiftUI app: sidebar + detail split view, chat workspace, home dashboard, integrations, settings window, command palette. | `apps/toby-app/Sources/TobyApp` |
| **Toby help site** | Public documentation (Docusaurus), dark-only, its own hotter orange. | `apps/help-site` |
| **Toby CLI + plugins** | Terminal surface and `@toby/plugin-*` packages. No visual design of its own beyond the plugin icons. | `apps/cli`, `apps/plugin-*` |

## Sources used to build this system

Nothing here was designed from scratch; every value was read out of the source.

- **GitHub:** <https://github.com/kshehadeh/toby>, worth exploring further before
  building anything new for Toby: the SwiftUI views are the real specification.
  Especially `apps/toby-app/Sources/TobyApp/UI/Theme/` (tokens),
  `UI/Primitives/` + `UI/SettingsControls/` (components), `Features/*` (screens),
  and `apps/help-site/src/css/custom.css` (web brand).
- **Last synced:** `2f06640` (v0.176.0), 2026-09-28. The React specimens are
  hand-written web recreations of the SwiftUI views, not a build of the app.
- **Docs read for tone:** `docs/*.md`, `apps/help-site/docs/**`, root `README.md`.
- The current **Toby Design System** Figma file is a catalog and visual
  reference. Its native component/page mapping and limitations are documented
  in `references/figma-map.md`; source remains authoritative.

There is **no vector logo** in the sources — the mark ships only as raster PNG
(`assets/logo/`), a line-drawn portrait of a bespectacled man in a suit. Where a
mark can't be used, set the wordmark **TOBY** in bold system type (all caps).
Nothing here was drawn or invented.

---

## Content fundamentals

**Voice: a competent colleague, not a mascot.** Copy states what a thing does and
what it will cost you. It never sells, never exclaims, and never apologizes at
length.

- **Person.** Speak to *you* about *Toby* in the third person: "What should
  Toby take care of?", "Toby can read and send mail for this account." Toby
  never says "I". Docs use *you* and imperatives: "Install Toby, set up AI,
  connect integrations, and start chatting."
- **Casing.** Sentence case everywhere: titles, buttons, menu items ("Check for
  updates", "Show more", "Run Now" is the one Title-Case exception). Uppercase
  is a *typographic device*, not a copy style: apply it to card-section eyebrows,
  badges, and transcript notice labels, never to buttons, sidebar labels or
  running prose.
- **Length.** Write row descriptions as one full sentence: "Keep Toby reachable
  without the main window." Keep destination help text to one sentence too:
  "Browse installed skills, inspect their instructions, edit them, or add new
  reusable workflows."
- **Empty states name the next action**, not the absence: "Content unavailable.
  {error}", "No due date", "Waiting for daemon", "Connecting".
- **Suggestions are written as user speech**, verb-first and specific:
  "Summarize unread mail that needs a reply", "Turn on Focus and minimize
  distracting windows".
- **Status vocabulary is fixed and short:** Connected · Connecting… · Disabled ·
  Idle · Error · Unknown · Completed · Overdue · Due today · Due tomorrow. Do
  not invent new status words.
- **Numbers are quiet.** "2 of 6 done", "×3", "1.4s", "42% full"; no
  celebratory framing, no percentages invented for decoration.
- **Priority labels** are exactly: *Needs attention · Worth noting · Ignore*.
  Reuse these exact words for triage content.
- **Typography of ellipsis and punctuation:** use a real ellipsis in progress
  labels ("Refreshing...", "Connecting…"), typographic apostrophes in prose
  ("today's calendar"), and em dashes in explanatory asides.
- **No emoji in the app.** The one exception is the help site's download CTA
  glyph (`⬇ Download Toby for macOS`) and emoji fallbacks for a third-party
  icon a plugin didn't ship. Do not add emoji to app UI.

## Visual foundations

**Platform.** Toby is a macOS 26 app, and the chrome is the system's: a Liquid Glass sidebar panel floating inside the window (inset 8px, rounded), a 52px toolbar whose controls sit in glass capsules (back/forward; record, settings, search), and capsule-shaped push buttons, pop-ups and segmented controls. Draw new surfaces inside that frame; don't paint over it. In web work, stand in for glass with the `.toby-glass` class (`tokens/primitives.css`) (`material-glass`, `material-glass-edge`, `blur-material`, `shadow-glass`) and flag it as an approximation.

**Colors.** Default to light, and follow the system appearance. Use the dynamic surfaces: `surface-content` for the detail column and dashboard cards, `surface-settings-canvas` for Settings and for every list column and detail pane, `surface-elevated` for the user bubble and resting tiles, `surface-card` for settings cards. Set *all* text and hairlines as alpha over the surface (`text-body` 88%, `text-muted` 55–58%, `text-faint` 38%, `border-hairline` 8–10%), never as opaque greys. On the help site, stay dark-only, near-black (`web-black` → `web-surface` → `web-surface-raised`) with `web-accent`.

**Accent.** Show one accent at a time: `toby-accent`, the user's preset (orange by default; blue, green, purple, pink, red, teal and gray also exist), identical in light and dark. Use it for the send button, the up-next onboarding tile, a selected browser row's glyph, "Show more", a card's … menu and plain buttons, and use its washes (`accent-wash-weak` 10%, `accent-wash` 18%, `accent-wash-strong` 22%, `accent-border-soft` 25%, `accent-border` 55%) for tints and strokes. Never add a second accent hue or a gradient of it. The one place other presets appear is Home's Actions tiles, which take each flow's own color (teal by default). Navigation carries no color: the `--toby-route-*` tokens are legacy.

**Type.** Use SF Pro everywhere, at small, few sizes: 26 (the Home greeting, bold, −0.45px) / 17 / 15 / 14 / 13 / 12 / 11 / 10. The transcript is plain SF Pro: set the answer and the user's bubble at 15px with 6pt of extra leading (`answer`, `leading-answer`) in a 720px reading column; there is no serif. SF Pro Rounded (`--font-rounded`) is reserved for transcript timestamps and notice labels; SF Mono (`--font-mono`) for paths, IDs and code. Dashboard card titles are 14px semibold, their summaries 13px secondary; browser-row titles 12px medium; sidebar section labels 10px tertiary in sentence case. Uppercase appears only as a small tracked eyebrow (10px semibold, +0.7px) over a card section and in badges. None of these faces ship as binaries: they resolve natively on macOS and fall back to `system-ui` / Georgia elsewhere; the help site loads Inter from Google Fonts.

**Spacing and density.** Keep things spacious, not dense: 24px content padding, 16px card padding, 14px under a card header, 42px settings rows, 640px settings column, 720px transcript column, 250px sidebar, 240px list column, 940px Home column. The scale is *not* a strict 4pt grid (5, 7, 9, 14, 22 all appear) and must be preserved verbatim. Separate things with whitespace and single hairlines.

**Backgrounds.** Use flat solid surfaces; the only translucency is the system's glass. Do not add imagery, gradients, patterns or textures. The only gradients allowed are functional: a card's "Show more" fade, and small brand-colored icon badges on the help site.

**Borders, cards, shadows.** A dashboard card is `surface-content` with a 1px `border-hairline` stroke and 16px concentric corners, a header (glyph, title, "last ran" time, refresh, …) closed by a divider; it keeps its natural height up to 340px, then clips into a 40px fade and a 36px "Show more" bar. Settings cards are `surface-card` + a 1px `border-card` + 10px corners. List rows use 8px corners, the user bubble 14px, onboarding tiles 12px, the dock, toasts and Actions tiles 16px; controls are capsules. Nothing casts a shadow except glass; there are no cap rules, corner glyphs or accent edges on cards.

**Motion.** Use short ease-outs, no bounce, no spring: 80ms popover dismiss, 120ms hover tints, 200ms disclosure, 250ms dashboard reflow. Repeating animations are limited to the pulsing accent dot of a running work step and the persona footer's attention pulse (850ms, opacity + 1.03 scale), the 800ms skeleton pulse, a running Actions tile's fill pulse, and a refresh glyph spinning one turn per 800ms *only while refreshing*. Respect Reduce Motion everywhere.

**Selection and hover.** Selected list rows take a `surface-selected` fill and promote their text from secondary to primary; a selected primary sidebar destination takes the stronger grey pill (`surface-selected-strong`). Glyphs in browser rows turn accent when selected. Hover adds at most a light wash; there is no press-scale, darkening or ripple, since macOS controls handle their own press states.

**Layout rules.** The window is a floating sidebar panel beside a detail area under the toolbar. Home is a greeting, a two-column grid of cards capped at 940px, and an Actions inspector column (about 156px) of colored flow tiles. Chats and every other workspace (Projects, Library, Skills, Schedules, Flows, Recordings, Script Tools) are a list column on the settings canvas beside a detail pane: build their rows from `SidebarRow` (the FeatureBrowserRow pattern), their loading and empty states from `FeatureBrowserList` / `FeatureBrowserPlaceholder`, and their detail panes from segmented tabs over an inset panel holding `DetailSection` blocks and a `DetailMetadata` grid. In a chat, float the glass `InputDock` over the transcript, pinned to the bottom, and reserve padding equal to its height. Cap settings content at 640px, left-aligned. An integration's settings page is a grouped Form: `IntegrationHeader` (icon, name, plain status, one action), then **Sign in** (a segmented `MethodPicker` plus that method's fields), one `SettingsGroup` per plugin field group, **Mentions** (the inbound toggle and its fields), the `ToolList`, **About**, and destructive Disconnect/Remove rows last. Saved secrets render as `SecretField` (Saved plus Change…), never a field of dots.

**Imagery vibe.** Keep imagery neutral and cool-grey; the only warmth is the accent. Persona portraits are flat line illustrations on light backgrounds, shown with 4px rounded corners. No photography, grain or duotone.

## Iconography

- **Use SF Symbols, referenced by name**, as the Swift source does (`house`, `message`, `folder`, `books.vertical`, `waveform`, `calendar`, `arrow.triangle.branch`, `graduationcap`, `arrow.clockwise`, `ellipsis`, `chevron.up.chevron.down`, …). Sidebar destination glyphs are monochrome in primary text; card header glyphs are 14px medium in primary text; work-step glyphs are tinted `toby-md-heading`; browser-row glyphs are tertiary, accent when selected; Actions tiles use white glyphs.
- **SF Symbols cannot be shipped to the web.** For HTML cards and UI kits, use **Lucide** (CDN, `lucide@0.417.0`), matched name-for-name to the SF Symbol it stands in for; the bundled components draw a few small inline equivalents themselves. Flag this substitution in any deliverable that will sit next to the real app.
- **Use the real raster icons that were copied in** rather than redrawing them: integration marks (email, todoist, slack, jira, notion, macos, apple-calendar, apple-reminders) and AI-provider marks (openai, ollama, openrouter, vercel, chutes) in `assets/icons/integrations/` and `assets/icons/ai/`.
- **There is no vector logo.** The mark ships only as raster PNGs (`assets/logo/`): a line-drawn portrait of a bespectacled man in a suit. Where a mark can't be placed, set the wordmark **TOBY** in bold system type, all caps; never redraw or vectorize the portrait.
- **Do not use emoji as app iconography.** A plugin manifest *may* provide an emoji string, which the integrations sidebar renders when no icon file exists; the help site uses `⬇` in its download CTA. That is the whole extent of it.
- **Unicode glyphs** stand in for a few affordances: `×3` counts, `✕` closers, `↗` external-link marks.
- The only illustration in the system is `assets/illustrations/toby-architecture.svg`.

---

## Index

| Path | What's there |
| --- | --- |
| `styles.css` | The single entry point: `@import`s only. |
| `tokens/` | `colors.css` (light/dark base, system colors, glass stand-in), `accents.css` (8 presets + legacy destination hues), `semantic.css` (aliases to use in product work), `typography.css`, `spacing.css`, `radius.css`, `elevation.css`, `motion.css`, `layout.css`, `web.css` (help site), `fonts.css`, `primitives.css` (the web helper classes the specimens use: `.toby-glass`, card-section dividers, pulse and spinner animations). |
| `components/` | React specimens grouped `core` / `forms` / `feedback` / `navigation` / `chat` / `dashboard` / `detail` / `settings`, plus `glyphs.jsx` (small inline stand-ins for the SF Symbols the components draw). |
| `_ds_bundle.js` | All components as one classic script on `window.TobyDesignSystem_28de33`, built from `components/**` with esbuild (IIFE, `react` / `react-dom` read from `window`). Rebuild it whenever a `.jsx` changes. |
| `ui_kits/toby-app/` | Click-through macOS 26 window: Home, Chats, Flows. See its README. |
| `ui_kits/help-site/` | Recreation of the documentation site (home, integrations, architecture). |
| `assets/` | `logo/`, `personas/`, `icons/integrations/`, `icons/ai/`, `illustrations/`. |
| `github.md` | Source repo association + screen map for upstream sync. |
| `SKILL.md` | Agent-skill wrapper. |
| `references/` | Source-backed component recipes, screen patterns, SwiftUI workflow, and Figma map. |

### Components

Grouped by concern; each has a `.jsx`, a `.d.ts` props contract, a
`.prompt.md` usage note, and one `@dsCard` showcase page per directory.

- **core**: `Button`, `IconButton`, `Badge`, `Chip`, `ProgressBar`
- **forms**: `SettingsCard`, `SettingsRow`, `SettingsSectionHeader`,
  `TextField`, `Select`, `Toggle`
- **feedback**: `InlineStatusMessage`, `Toast`, `Skeleton`
- **navigation**: `SidebarSection`, `SidebarRow` (destination and browser-row
  variants), `PersonaFooter`, `SidebarActionGrid` (deprecated)
- **chat**: `InputDock`, `UserMessage`, `AssistantMessage`, `WorkStepRow`
- **dashboard**: `DashboardCard`, `CardSection`, `FlowRunnerCard` (Actions rail
  tile), `OnboardingTile`
- **detail**: `DetailSection`, `DetailMetadata`
- **settings**: `IntegrationHeader`, `SettingsGroup`, `SettingsFormRow`,
  `SecretField`, `MethodPicker`, `ToolList` (the grouped-Form integration
  page; see the Integration settings card)

The inventory mirrors what the app actually defines (`UI/Primitives`,
`UI/SettingsControls`, and the reusable row/card types inside `Features/`).
Nothing was added that has no counterpart in the source: no Tabs, no Avatar,
no Tooltip, no Dialog, because the app builds those from stock SwiftUI.
Two renames for clarity: `Toggle` ← `SettingsToggle`, `TextField` ←
`SettingsInlineField`. Production source mapping and behavioral contracts are
in [`references/component-recipes.md`](references/component-recipes.md).

### Reference limits

- Not recreated: the command palette, logs viewer, markdown editor,
  permissions screen, Script Tools editor, and the Projects, Library, Skills,
  Memories, Schedules and Recordings detail panes. Primitives with no specimen:
  `CopyButton`, `InlineTitleField`, `EditorSheet`, `GatewayFundsBanner`,
  `IntelligenceOutline`.
- No font binaries are committed: SF Pro / SF Pro Rounded / New York resolve
  natively on macOS and fall back to `system-ui` / Georgia elsewhere. Inter is
  loaded from Google Fonts, exactly as the help site does.
- SF Symbols → Lucide / inline glyph substitution, and Liquid Glass → the
  `.toby-glass` approximation (see above).
- The UI kit and Figma layout references intentionally simplify dynamic
  behavior. They do not define source-of-truth state, scrolling, focus,
  accessibility, AppKit window behavior, or async ownership.
- The Figma file's variables, components, and current limits are mapped in
  [`references/figma-map.md`](references/figma-map.md).
