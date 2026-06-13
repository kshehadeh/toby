# Projects

Projects collect AI-generated artifacts in one place over time, with their own
reference context and pinned skills so outputs stay consistent across sessions.

## Concept

A **project** is a folder under `~/.toby/projects/<slug>/` that holds:

```
~/.toby/projects/weekly-overview/
  project.json       # name, pinned skills, pinned integrations
  context/           # reference documents the AI reads each turn
  outputs/           # generated artifacts (reports, summaries, etc.)
```

When a project is **active**, two things happen automatically every chat turn:

1. **Context injection** — every file in `context/` is loaded into the system
   message so the AI has the same reference material every time.
2. **Output scoping** — `writeTextFile` writes to the project's `outputs/`
   folder by default (instead of `~/.toby/generated-files`), keeping all
   generated artifacts together.

This makes projects ideal for recurring workflows like weekly overviews, monthly
reports, or any task where you want the AI to produce consistent output informed
by the same reference material each time.

## Creating a project

In chat, type `/project` and select **Add Project**. Toby prompts you for a
name, creates the folder structure, and activates it.

You can also create a project through the **configure UI** (`/config`), under
the **Projects** section: choose **Add Project** and fill in the name.

## Activating and switching projects

Type `/project` in chat to open the project picker. Use the arrow keys to
select a project and press **Enter** or **a** to activate it.

The picker also offers:

- **Clear** — deactivate the current project (reverts to default
  `~/.toby/generated-files` for output).
- **Add** — create a new project.

Activating a project reboots the session so that the project's context documents
are injected fresh into the system message.

## Project detail view

After selecting a project in the picker, the detail modal shows:

- **Context files** — reference documents the AI reads every turn.
- **Output files** — generated artifacts stored in the project.
- **Pinned skills** — local skills that should apply to this project.
- **Context integrations** — integrations whose data is relevant to the project.

Press **e** to edit the project in the configure UI, or **Esc** to go back.

## Editing a project

From the detail view, press **e**, or navigate to `/config` → **Projects** →
the project name. Editable fields:

| Field | Description |
| ----- | ----------- |
| **Name** | Display name. |
| **Skills** | Comma-separated local skill names to pin to this project. |
| **Integrations** | Comma-separated integration names to associate with this project. |
| **Delete project** | Removes the project folder and all its contents. |

### Adding context documents

Place any text file (Markdown, JSON, YAML, CSV, etc.) into the project's
`context/` directory:

```bash
cp style-guide.md ~/.toby/projects/weekly-overview/context/
```

Supported extensions: `.md`, `.markdown`, `.txt`, `.text`, `.json`, `.yaml`,
`.yml`, `.csv`, `.tsv`, `.log`, `.xml`, `.html`, `.rst`.

Files larger than 64 KB are skipped. Total context is capped at 256 KB per
turn. Subdirectories are supported up to 6 levels deep. Dot-prefixed files and
symlinks are ignored.

### Adding output files

Output files are created by the AI via `writeTextFile` during chat. They land in
the project's `outputs/` directory automatically. You can also manually add
files there if you want to organize outputs yourself.

## Writing files within a project

When a project is active, the `writeTextFile` tool behavior changes:

| Location parameter | Destination |
| ------------------ | ----------- |
| `outputs` (default) | `~/.toby/projects/<slug>/outputs/` |
| `context` | `~/.toby/projects/<slug>/context/` |

Use `location='context'` when you want the AI to read the file in future turns
(as reference material). Use `location='outputs'` (or omit it) for generated
artifacts that do not need to be re-read.

When no project is active, `writeTextFile` falls back to
`~/.toby/generated-files/`.

## Pinned skills

Each project can declare **pinned skills** — local skills from
`~/.toby/skills/` that are relevant to the project's workflow. For example, a
project that generates weekly email digests might pin a skill like
`email-triage` that provides formatting and prioritization instructions.

Pinned skills are stored in `project.json` and shown in the project detail
view. They serve as a record of which skills are appropriate for the project.
Select skills from a multi-select picker via `/config`.

To create a new skill for a project, ask Toby in chat:
"Create a skill for weekly email summaries" — when a project is active,
the `createLocalSkill` tool saves the `SKILL.md` under the project's
`skills/` directory so it is automatically included in that project's sessions.
Global skills (under `~/.toby/skills/`) can also be pinned to a project
via the multi-select picker in `/config`.

## Project-local skills

Skills placed in the project's `skills/` directory are automatically loaded
and injected into the system prompt when that project is active, as if they
were built-in. No pinning is needed — every `SKILL.md` under
`~/.toby/projects/<slug>/skills/` is included automatically.

## Example: weekly overview project

```
# 1. Create the project
/project  →  Add Project  →  name: "Weekly Overview"

# 2. Add reference context
cp last-weeks-overview.md ~/.toby/projects/weekly-overview/context/
cp team-goals.md ~/.toby/projects/weekly-overview/context/

# 3. Create a skill for consistent formatting
"Create a skill called weekly-overview-format that formats a weekly status
 update with sections: Accomplishments, Blockers, Priorities Next Week.
 Write it in a concise bullet-point style."

# 4. Pin the skill to the project
/config  →  Projects  →  weekly-overview  →  Pinned skills  →  select weekly-overview-format

# 5. Generate each week
"Generate this week's overview based on my recent emails and tasks"
 → output lands in ~/.toby/projects/weekly-overview/outputs/
```

Over time, the `outputs/` folder accumulates each weekly overview, all produced
with the same style and informed by the same reference documents.

## File layout reference

```
~/.toby/projects/
  <slug>/
    project.json        # {"name":"...","slug":"...","skills":[...],"integrations":[...]}
    context/            # reference docs injected into the system prompt
      style-guide.md
      team-goals.md
    outputs/            # generated artifacts from writeTextFile
      2026-06-13-weekly-overview.md
      2026-06-06-weekly-overview.md
    skills/             # project-local skills (auto-loaded when project is active)
      weekly-format/SKILL.md
```

## Implementation

- **Core model**: [`packages/core/src/projects/index.ts`](../packages/core/src/projects/index.ts) — `Project` type, CRUD, context loading, prompt formatting.
- **Config persistence**: [`packages/core/src/config/index.ts`](../packages/core/src/config/index.ts) — `getActiveProjectSlug`, `setActiveProjectSlug`, `clearActiveProjectSlug`.
- **Pipeline injection**: [`packages/core/src/chat-pipeline/nodes/assemble-messages.ts`](../packages/core/src/chat-pipeline/nodes/assemble-messages.ts) — loads context docs and injects them into the system message when `ctx.project` is set.
- **Tool scoping**: [`packages/core/src/ai/global-chat-tools.ts`](../packages/core/src/ai/global-chat-tools.ts) — `writeTextFile` resolves paths relative to the active project's `outputs/` or `context/` directory.
- **Slash command**: [`apps/cli/src/ui/chat/slash-commands/project.ts`](../apps/cli/src/ui/chat/slash-commands/project.ts) — `/project` opens the picker.
- **UI modal**: [`apps/cli/src/ui/chat/components/project-detail-modal.tsx`](../apps/cli/src/ui/chat/components/project-detail-modal.tsx) — project detail view.
- **Configure UI**: [`packages/core/src/configure/tree.ts`](../packages/core/src/configure/tree.ts) — project fields in the settings tree.
