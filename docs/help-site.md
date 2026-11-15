# Help site (www.tobyai.app)

`apps/help-site` is a static Next.js export (`output: "export"`) deployed by the
Vercel project `toby-docs`. It has two parts:

| Route | Source | Purpose |
| ----- | ------ | ------- |
| `/` | `src/app/page.tsx` + `src/components/landing/` | Marketing landing page |
| `/docs` | `src/app/docs/page.tsx` | Docs index (section grid) |
| `/docs/<id>` | `docs/<id>.mdx` | User docs, sidebar from `src/lib/sidebar.ts` |

Dev loop: `bun run --cwd apps/help-site dev`. Checks: `lint`, `typecheck`, and
`build` in the same package (the build fails on broken doc links).

## Design system

The look follows Linear's marketing site: a near-black canvas, layered
surfaces, alpha-white hairlines, large tight display type, and Toby orange used
sparingly. The site is dark only. This is separate from the native app's
`DESIGN.md`.

Tokens live in the `@theme` block of `src/app/globals.css`:

| Token | Use |
| ----- | --- |
| `canvas`, `surface`, `surface-raised`, `surface-hover` | Page background and stacked panels |
| `line-subtle`, `line`, `line-strong` | White hairlines at 5%, 8%, and 14% |
| `fg`, `muted`, `faint` | Primary, body, and quiet text |
| `accent`, `accent-dim`, `accent-soft` | Orange for the primary CTA, eyebrows, and glows only |
| `text-display-{xl,lg,md}` | Fluid headline sizes with negative tracking |

Shared utilities in the same file: `text-gradient` (white-to-gray headline
fill), `mask-fade-b`, `bg-grid`, `glow-accent`, plus the `spotlight` and
`hero-shot` component classes.

### Components

- `Button.tsx`: `ButtonLink` / `buttonClass` with `primary` (light), `accent`
  (orange), `secondary` (outline), and `ghost` variants.
- `DownloadTobyButton.tsx`: DMG link that shows the latest release version.
- `landing/primitives.tsx`: `Container`, `Eyebrow`, `SectionHeading`,
  `TextLink`, `Screenshot` (framed app image).
- `landing/SpotlightCard.tsx`: bento tile with a pointer-following highlight.
- `landing/ScrollReveal.tsx`: adds `data-visible` to `[data-reveal]` elements as
  they enter the viewport.

### Motion

Elements with `data-reveal` fade and rise in once. Content is only hidden when
`<html>` has the `js` class (set by an inline script in `layout.tsx`), so the
page stays readable without JavaScript. `prefers-reduced-motion` disables the
reveal, the hero tilt, and tile hover movement.

## Landing screenshots

Landing images live in `public/img/landing/` and are captured from Toby (Dev)
in **dark mode with the orange accent** against the generic data home
(`bun run app:screenshots`), following the `toby-screenshot-docs` skill. Avoid
the Home dashboard (its greeting uses the macOS account name) and project
folder paths (they include the username).

| File | Subject |
| ---- | ------- |
| `hero.png` | Chats → "Unread email summary" (full window) |
| `briefing.png` | Chats → "Morning briefing" (full window) |
| `flow-detail.png` | Flows → "Email Summary" (full window) |
| `chat.png`, `flows.png`, `memories.png`, `projects.png`, `library.png` | Content-pane crops for the bento tiles |

The Recordings tile uses an HTML mock instead of a screenshot so no real
transcript content is published.

## Doc screenshots

The `toby-app-*.png` images used by the doc pages follow the same rules: dark
mode, orange accent, generic data home. Capture them on a Retina display with
cua-driver's `max_image_dimension` raised to 2048 so full-window shots land at
2x (2048×1440 for the main window). Blur the folder path in the Projects and
Settings > General shots, since both show the macOS username. The
`toby-app-home-color-{light,dark}.png` pair intentionally shows both
appearances.
