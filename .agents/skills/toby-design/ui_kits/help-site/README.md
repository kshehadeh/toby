# Toby help site — UI kit

Recreation of the Docusaurus documentation site at
https://toby.iwonderdesigns.com, built from `toby/apps/help-site`
(`src/css/custom.css`, `src/pages/index.tsx`, `src/pages/index.module.css`,
`src/components/DownloadTobyButton.tsx`, `docs/**`).

Open `index.html`. Three pages are wired: the docs home, the integrations
overview (with the real plugin icon grid), and the architecture page (with the
repo's own architecture SVG). The navbar, sidebar, breadcrumbs, TOC rail, cards
and code blocks all use the site's own values.

The site is **dark-only** and uses its own hotter orange (`--web-accent`,
`#f97316`) — not the app's accent token. Type is Inter. Sidebar category icons
in the real site are inline Lucide-style SVG CSS masks; here they are Lucide
from CDN, which is the same icon family.

Not recreated: search modal, versioned docs, mobile drawer.
