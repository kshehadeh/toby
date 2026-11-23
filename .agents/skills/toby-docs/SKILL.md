---
name: toby-docs
description: >
  Keep Toby documentation in sync when product or developer-facing behavior
  changes: the user help site (`apps/help-site/`) and the contributor guides
  (`CLAUDE.md`, `AGENTS.md`). Use when implementing or changing features,
  enhancing existing functionality, fixing user-visible behavior, or whenever
  it is unclear whether docs need updating — ask the user if unsure. Also use
  when the user runs /toby-docs or asks to update docs.
---

# Keep docs and help-site in sync

## Goal

Whenever functionality changes or is added, update the documentation that
already covers that area (or create coverage for new user-facing work). Do not
treat code as done if the docs that describe it are now wrong or missing.

## Documentation surfaces

| Surface | Path | Audience | Style |
| --- | --- | --- | --- |
| **Help site** | `apps/help-site/docs/` | End users of Toby.app | How-to, setup, product surfaces, sources, settings |
| **Contributor guides** | `CLAUDE.md`, `AGENTS.md` | Contributors and agents | Layout, architecture, build/test/release commands |

When you add help-site pages, add them to the sidebar in `src/lib/sidebar.ts`.

Screenshots for the native app live under `apps/help-site/public/img/` and are
referenced from help-site pages. For UI screenshot refreshes, use the
**toby-screenshot-docs** skill (discover changed surfaces, capture reliably with
cua-driver, crop to the subject region).

## When this skill applies

**Always apply after (or as part of) work that:**

1. **Changes existing documented behavior** — anything already described in
   `apps/help-site/docs/` (UI, settings, sources, flows, projects, memory,
   recordings, sync/backup, data paths, etc.).
2. **Adds new functionality** — a new feature, surface, source, or setting.
3. **Enhances an existing feature** — new options, workflows, defaults, or
   capabilities users need to know about.
4. **Fixes user-visible behavior** when the docs currently state the old
   (wrong) behavior.
5. **Changes how contributors build, test, or release** — update `CLAUDE.md` /
   `AGENTS.md`.

**Usually skip for:**

- Pure refactors with no behavior or interface change
- Internal-only cleanups (tests, types, formatting)
- One-off debug scripts or throwaway local tooling

## If it is unclear: ask

If you are not sure whether the change is documentation-worthy, **ask the user
before finishing**, for example:

- Whether the change should be reflected in `docs/`, the help site, or both
- Whether a full new page is needed vs. a small edit
- Whether UI screenshots should be refreshed

Do not silently skip docs when the answer is ambiguous.

## Workflow

### 1) Identify what changed

From the task and the diff, list new or changed Toby.app UI surfaces or
settings, sources and chat tools, config paths or `~/.toby` layout, and
behavior users will notice in chat, Home, flows, projects, memory, recordings,
or sync. Note build/test/release changes for the contributor guides.

### 2) Find existing coverage

```bash
rg -n -i "<topic keywords>" apps/help-site/docs/ CLAUDE.md AGENTS.md
```

Check the closest user-facing page (`getting-started/`, `integrations/`,
`configuration/`, `toby-app.mdx`, feature pages).

### 3) Update the right places

- **Help site**: clear steps, product language (Settings section names exactly
  as in the app: General, Account, Sources, Personas, Follow-ups, Recordings,
  Chat Replies, Sync & Backup, Permissions), few implementation details.
- **Contributor guides**: accurate commands and paths.
- Unclear scope: **ask the user**.

### 4) New pages

When creating a **new** doc:

1. Add a `.mdx` file under the right folder (`getting-started/`,
   `integrations/`, `configuration/`, top-level feature page, etc.). The file path is
   the URL: `docs/integrations/foo.mdx` → `/docs/integrations/foo`.
2. Use frontmatter consistent with neighboring pages (`title`, optional
   `description` and `sidebar_label`).
3. Add the doc id to the sidebar in `apps/help-site/src/lib/sidebar.ts`
   (pages not listed there still build but have no sidebar entry or
   prev/next links).
4. Components are available in every page **without imports**: `<Callout
   type="note|tip|info|warning|danger" title="…">` (leave blank lines around
   the markdown body), `<FeatureHeading>`, `<BrandTitle>`, `<InlineIcon>`,
   `<IntegrationGrid>`/`<IntegrationCard>`, `<ArchitectureDiagram>`,
   `<DownloadTobyButton>`. Add new ones in `src/components/mdx/` and register
   them in `src/components/mdx/index.tsx`. Docusaurus `:::tip` syntax is **not**
   supported. Style with Tailwind classes (`className="…"`).
5. Links may be relative (`./email`, `../toby-app`, `../automations.mdx`) or
   absolute (`/docs/intro`); the build fails on links to missing docs.
6. If screenshots are needed for Toby.app UI, place images under
   `apps/help-site/public/img/` and reference them as `/img/...`. Prefer the
   **toby-screenshot-docs** skill for capture workflow and change discovery.

### 5) Consistency checks

Before considering the work complete:

- [ ] Statements of behavior match the code you shipped
- [ ] Command names, flags, tool names, and config keys match exactly
- [ ] Cross-links still resolve (no stale paths)
- [ ] New pages added to `src/lib/sidebar.ts`
- [ ] If help-site content changed substantially, optionally verify:
  ```bash
  cd apps/help-site && bun run build
  ```

### 6) Report what you did

In the handoff, list the help-site pages and contributor-guide sections you
changed, and anything you did **not** document and why.

## Decision shortcuts

- **Toby.app UI or settings** → help-site `docs/toby-app.mdx`, `configuration/`
  and the feature page.
- **Sources (Mail, Slack, Apple apps)** → help-site `docs/integrations/`.
- **AI / models** → help-site `docs/ai-providers/openrouter.mdx` and
  `getting-started/setup-ai.mdx`.
- **Build, test, release, layout** → `CLAUDE.md` and `AGENTS.md`.

## What not to do

- Do not invent product promises that the code does not implement.
- Do not dump raw implementation notes into the help site.
- Do not edit `apps/help-site/out/` or `.next/` — that is generated output.
- Do not skip asking when scope is ambiguous.
