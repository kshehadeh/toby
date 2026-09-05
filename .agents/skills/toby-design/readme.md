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
possible** — light/dark that follows the system, a user-selectable accent color,
and layouts that stay *spacious, never busy*.

## Products represented

| Surface | What it is | Design source |
| --- | --- | --- |
| **Toby for macOS** | The main product. SwiftUI app: sidebar + detail split view, chat workspace, home dashboard, integrations, settings window, command palette. | `apps/toby-app/Sources/TobyApp` |
| **Toby help site** | Public documentation (Docusaurus), dark-only, its own hotter orange. | `apps/help-site` |
| **Toby CLI + plugins** | Terminal surface and `@toby/plugin-*` packages. No visual design of its own beyond the plugin icons. | `apps/cli`, `apps/plugin-*` |

## Sources used to build this system

Nothing here was designed from scratch; every value was read out of the source.

- **GitHub:** <https://github.com/kshehadeh/toby> — worth exploring further before
  building anything new for Toby: the SwiftUI views are the real specification.
  Especially `apps/toby-app/Sources/TobyApp/UI/Theme/` (tokens),
  `UI/Primitives/` + `UI/SettingsControls/` (components), `Features/*` (screens),
  and `apps/help-site/src/css/custom.css` (web brand).
- **Attached codebase:** the same repo mounted locally as `toby/`.
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

- **Person.** Product UI speaks to *you* about *Toby* in the third person:
  "What should Toby take care of?", "Toby can read and send mail for this
  account." Toby never says "I". Docs use *you* and imperatives: "Install Toby,
  set up AI, connect integrations, and start chatting."
- **Casing.** Sentence case everywhere — titles, buttons, menu items ("Check for
  updates", "Show more", "Run Now" is the one Title-Case exception in the app).
  Uppercase is a *typographic device*, not a copy style: it is applied by the UI
  to step metadata, sidebar section labels, and dashboard summary headings.
- **Length.** Row descriptions are one full sentence: "Keep Toby reachable
  without the main window." Destination help text is one sentence too: "Browse
  installed skills, inspect their instructions, edit them, or add new reusable
  workflows."
- **Empty states name the next action**, not the absence: "Content unavailable.
  {error}", "No due date", "Waiting for daemon", "Connecting".
- **Suggestions are written as user speech**, verb-first and specific:
  "Summarize unread mail that needs a reply", "Turn on Focus and minimize
  distracting windows".
- **Status vocabulary is fixed and short:** Connected · Connecting… · Disabled ·
  Idle · Error · Unknown · Completed · Overdue · Due today · Due tomorrow.
- **Numbers are quiet.** "2 of 6 done", "×3", "1.4s", "42% full" — no
  celebratory framing, no percentages invented for decoration.
- **Priority labels** from the personas: *Needs attention · Worth noting ·
  Ignore*. Reuse these exact words for triage content.
- **Typography of ellipsis and punctuation:** real ellipsis in progress labels
  ("Refreshing...", "Connecting…"), typographic apostrophes in prose ("today’s
  calendar"), em dashes in explanatory asides.
- **No emoji in the app.** The one exception is the help site's download CTA
  glyph (`⬇ Download Toby for macOS`) and emoji fallbacks for third-party icons
  a plugin didn't ship. Do not add emoji to app UI.

## Visual foundations

**Colors.** Two independent palettes. The app uses dynamic AppKit colors that
flip with the system appearance; surfaces are neutral greys (light: `#f2f2f5`
sidebar → `#fcfcfc` content; dark: `#1f2426` sidebar → `#141414` content) and
*all* text and hairlines are alpha over the surface (88% / 55–58% / 38%), never
opaque greys. The help site is dark-only, near-black (`#000` → `#0a0a0a` →
`#141414`) with `#f97316`.

**Accent.** One accent at a time, chosen by the user from eight presets (orange
is default) and identical in light and dark. Accent appears as: the send-button
and up-next fills, small glyph marks, "Show more" links, the dashboard block's
cap rule, and 10 / 18 / 22 / 25 / 55 % opacity washes for wash, hover, selection
and borders. Never a second accent hue, never a gradient of it. Sidebar
destinations are the only place with a fixed multi-hue set (one identity color
per destination), and even there the color only shows as an 18–22% wash.

**Type.** System faces only: SF Pro for chrome, **SF Pro Rounded** for the chat
transcript and step chrome, the system **serif** (New York) at 15px/1.5 for
assistant answers — the one deliberate typographic break, so a response reads
like a document — and SF Mono for logs, JSON and paths. Sizes are small and few:
17 / 15 / 13 / 12 / 11 / 10.5 / 10. Step metadata is 10.5px semibold uppercase
with +0.07em tracking so it recedes behind the answer. The help site is Inter,
with tight display tracking (−0.025em) and 1.7 prose leading.

**Spacing and density.** Spacious, not dense: 24px content padding, 22px card
padding, 42px settings rows, 640px form column, 520/640px transcript columns,
250px sidebar. The scale is *not* a strict 4pt grid — 5, 7, 9, 14, 22 all appear
in source and are preserved verbatim. Whitespace, not rules, separates things:
one hairline divider per card at most.

**Backgrounds.** Flat solid surfaces. No imagery, no gradients, no patterns or
textures anywhere in the app. The only gradients are functional: the
bottom-of-card "Show more" fade, and small brand-colored icon badges on the help
site. Photography and illustration appear only as persona portraits and the
architecture diagram.

**Borders, cards, shadows.** Settings cards are a flat card fill + a 1px hairline
border (8% alpha) + radius; no shadow in their resting state. Dashboard blocks
drop the border entirely: flat panel fill, a 2px accent rule capping the top, and
an oversized flat glyph at 4.5% opacity in the lower-right corner. Shadows are
rare, always downward, and reserved for things that float: the input dock
(`0 12px 20px / 16%`), toasts (`0 6px 16px / 22%`), popovers (`0 8px 14px /
28%`), an expanded dashboard card (`0 6px 12px / 18%`). Radii: 16 cards & dock,
14 message bubbles, 12 tiles, 10 settings cards, 9 rows/buttons, 8 list rows,
6 controls, pill for chips and switches.

**Transparency and blur.** Used sparingly and only for floating chrome: toasts
use ultra-thin material; the help-site navbar blurs at ≥997px. Everything else
is opaque. Transparency *as alpha on text and separators* is, by contrast,
the foundation of the whole palette.

**Motion.** Default motion is short and quiet: 80ms popover dismiss, 120ms
hover tints, and 200ms disclosure. Damped springs are reserved for meaningful
toast and dashboard section transitions. State-signaling attention animation
may use a 1.03 persona scale, recording pulse, or symbol effect. A refresh
glyph spins only while refreshing. Everything new must respect Reduce Motion.

**Hover and press.** Hover = a neutral 6–8% wash, or an 18% wash of the item's
own hue, plus a promotion of text from muted → primary; sidebar destination
glyphs also swap monochrome → palette rendering. Selected = the same wash at
22%, held. There is **no press-scale, no darkening, no ripple** — macOS controls
handle their own press states.

**Layout rules.** A fixed 250px sidebar (resizable to 320) beside a scrolling
detail column; a 52px toolbar; the composer floats over the transcript, pinned
to the bottom with an 18px gutter, and the transcript reserves padding equal to
the composer's measured height. Dashboard cards share a fixed 340px collapsed
height so a row aligns. Settings content is capped at 640px and left-aligned.

**Imagery vibe.** Neutral and cool-grey; the only warmth in the interface is the
accent. Persona portraits are flat line/vector-style illustrations on light
backgrounds, circular-masked. No photography, no grain, no duotone.

## Iconography

- **The app's icon system is SF Symbols**, referenced by name in Swift
  (`message`, `rectangle.3.group`, `wand.and.stars`, `arrow.clockwise`,
  `chevron.up.chevron.down`, …). Weights are `.medium`/`.semibold` at 10–18pt;
  the dashboard ghost glyph is ~120px flat at 4.5% opacity (it was a rotated,
  shadowed 54pt stamp in the app — simplified here). Some
  destinations swap to the `.fill` variant on hover.
- **SF Symbols cannot be shipped to the web.** The HTML cards and UI kits here
  use **Lucide** (CDN, `unpkg.com/lucide@0.417.0`), matched name-for-name to the
  SF Symbol in the source — same 24px grid, ~2px stroke, rounded caps. **This is
  a substitution; flag it in any deliverable that will sit next to the real app.**
  In native work, use the SF Symbol names from the Swift source.
- **Real raster icons were copied in** and should always be used instead of
  redrawing: integration marks in `assets/icons/integrations/` (email, todoist,
  slack, jira, notion, macos, apple-calendar, apple-reminders) and AI-provider
  marks in `assets/icons/ai/` (openai, ollama, openrouter, vercel, chutes).
- **Emoji** are not used as app iconography. A plugin manifest *may* provide an
  emoji string, which the integrations sidebar renders as a fallback when no icon
  file exists; the help site uses `⬇` in its download CTA. That is the whole
  extent of it.
- **Unicode glyphs** stand in for a few affordances: `×3` counts, `✕` closers,
  `↗` external-link marks, `→` on tile CTAs.
- The only illustration in the repo is `assets/illustrations/toby-architecture.svg`.

---

## Index

| Path | What's there |
| --- | --- |
| `styles.css` | The single entry point — `@import`s only. |
| `tokens/` | `colors.css` (light/dark base), `accents.css` (8 presets + destination hues), `semantic.css` (aliases to use in product work), `typography.css`, `spacing.css`, `radius.css`, `elevation.css`, `motion.css`, `layout.css`, `web.css` (help site), `fonts.css`. |
| `guidelines/` | 23 specimen cards for the Design System tab: surfaces (light/dark), text tiers, accents, accent washes, destination hues, status, syntax, web palette, font families, app scale, assistant prose, step chrome, web type, spacing, density, radii, elevation, motion, logo, personas, integration icons, provider icons. |
| `components/` | React primitives, grouped `core` / `forms` / `feedback` / `navigation` / `chat` / `dashboard`. |
| `ui_kits/toby-app/` | Click-through recreation of the macOS app (dashboard, chat, integrations, settings). See its README. |
| `ui_kits/help-site/` | Recreation of the documentation site (home, integrations, architecture). |
| `assets/` | `logo/`, `personas/`, `icons/integrations/`, `icons/ai/`, `illustrations/`. |
| `github.md` | Source repo association + screen map for upstream sync. |
| `SKILL.md` | Agent-skill wrapper for use outside this project. |
| `references/` | Source-backed component recipes, screen patterns, SwiftUI workflow, and Figma map. |

### Components

Grouped by concern; each has a `.jsx`, a `.d.ts` props contract, a
`.prompt.md` usage note, and one `@dsCard` per directory.

- **core** — `Button`, `IconButton`, `Badge`, `Chip`, `ProgressBar`
- **forms** — `SettingsCard`, `SettingsRow`, `SettingsSectionHeader`,
  `TextField`, `Select`, `Toggle`
- **feedback** — `InlineStatusMessage`, `Toast`, `Skeleton`
- **navigation** — `SidebarSection`, `SidebarRow`, `SidebarActionGrid`,
  `PersonaFooter`
- **chat** — `InputDock`, `UserMessage`, `AssistantMessage`, `WorkStepRow`
- **dashboard** — `DashboardCard`, `CardSection`, `FlowRunnerCard` (Actions rail row), `OnboardingTile`

The inventory mirrors what the app actually defines (`UI/Primitives`,
`UI/SettingsControls`, and the reusable row/card types inside `Features/`).
Nothing was added that has no counterpart in the source — no Tabs, no Avatar,
no Tooltip, no Dialog, because the app builds those from stock SwiftUI.

**Intentional additions:** none. Two renames for clarity: `Toggle` ←
`SettingsToggle`, `TextField` ← `SettingsInlineField`.

This visual catalog contains **26 named component families**. Their production
source mapping and behavioral contracts are in
[`references/component-recipes.md`](references/component-recipes.md).

### Reference limits

- No font binaries: SF Pro / SF Pro Rounded / New York resolve natively on
  macOS and fall back to `system-ui` / Georgia elsewhere. Inter is loaded from
  Google Fonts, exactly as the help site does.
- SF Symbols → Lucide substitution (see Iconography).
- The UI kit and Figma layout references intentionally simplify dynamic
  behavior. They do not define source-of-truth state, scrolling, focus,
  accessibility, AppKit window behavior, or async ownership.
- The Figma file's variables, components, and current limits are mapped in
  [`references/figma-map.md`](references/figma-map.md).
