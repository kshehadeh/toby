# Projects

Projects collect AI-generated artifacts in one place over time, with project
guidance (`AGENTS.md`), optional project-local skills, and scoped file output so
recurring workflows stay consistent across sessions.

## Concept

A **project** is:

1. A **row in `chat.sqlite`** (`projects` table) with id, slug, name, summary,
   optional default persona, and a folder path.
2. A **folder on disk** (default `~/.toby/projects/<slug>/`) that holds guidance,
   skills, user-attached files, and generated outputs.

When a project is **active** (or attached to a chat session), each turn:

1. **Guidance injection** — the project’s `AGENTS.md` (if present and ≤ 96 KB)
   is loaded into the system prompt as project guidance.
2. **Skill loading** — skills under the project’s `.agent/skills/` (and legacy
   `skills/`) are available like local skills for that session.
3. **Output scoping** — `writeTextFile` defaults to the project’s `outputs/`
   directory (instead of `~/.toby/generated-files`).

Implementation: [`packages/core/src/projects/index.ts`](../packages/core/src/projects/index.ts).

## Creating and managing projects

Use **Toby.app** (Projects UI / settings) or the daemon HTTP API:

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/projects` | List projects |
| `POST` | `/api/projects` | Create (`name`, optional `summary`, `folderPath`, `personaName`) |
| `GET` / `PATCH` / `DELETE` | `/api/projects/:idOrSlug` | Detail, update, delete |
| `GET` | `/api/projects/:idOrSlug/tree` | Folder tree for the native file browser |

Active project slug is stored in config via `getActiveProjectSlug` /
`setActiveProjectSlug` / `clearActiveProjectSlug` in
[`packages/core/src/config/index.ts`](../packages/core/src/config/index.ts).
Chat sessions and schedules can also reference a `project_id`.

There is **no** terminal `/project` or `/config` slash-command UI; interactive
management lives in Toby.app. The Home sidebar lists the five most recently
updated projects; selecting one opens that project’s details page. The Projects
sidebar lists each project (name, chat count, persona). Selecting a project
opens a details page in the main pane (new chat, recent chats, metadata, file
tree). Right-click a project to open any of its ten most recently updated chats
directly. File → **New Chat** (⌘N) starts a new chat in the selected project.
The main-window toolbar is context-sensitive: **+** (new project) when
nothing is selected; **New Chat** and **Delete** on a project page. Clicking
**Projects** shows all projects as cards, or an empty state if none exist.
Project chats are not listed in the sidebar; while a project chat is open, the
toolbar shows a folder icon and a control to return to the project page, and the
project stays highlighted in the sidebar. Project chats also open a trailing
**Files** inspector by default. Its toolbar button hides or shows the inspector;
the tree refreshes while the chat runs and briefly labels added, updated, and
deleted entries. A new project chat identifies its project with a **New
“Project Name” Chat** title and a folder icon overlaid with the active persona.

### Editable metadata

| Field | Description |
| ----- | ----------- |
| **Name** | Display name |
| **Summary** | Short description included in project prompt context |
| **Persona** | Optional project-default persona |
| **Folder path** | Absolute path to the project canvas directory |

Deleting a project removes the DB row and clears session/schedule links; the
on-disk folder is not automatically wiped by the core delete helper (confirm
behavior in the native UI before removing files you care about).

## Project guidance (`AGENTS.md`)

On create, Toby ensures an `AGENTS.md` at the project folder root (default
placeholder instructions). Edit this file to steer every project chat turn.

Only **`AGENTS.md`** is auto-injected today. Other files in the folder are not
scanned into the system prompt (see legacy note below).

## Project-local skills

Skills under:

```text
~/.toby/projects/<slug>/.agent/skills/<skill-name>/SKILL.md
```

are loaded when the project is active (`loadProjectSkills`). A legacy path
`skills/` at the project root is still scanned for older projects.

When a project is active, **`createLocalSkill`** can write under the project
skills directory so the skill is scoped to that project. Global skills remain
under `~/.toby/skills/`.

## Writing files within a project

| `writeTextFile` location | Destination when a project is active |
| ------------------------ | ------------------------------------ |
| `outputs` (default) | `<projectFolder>/outputs/` |
| `context` | Project **folder root** (reference files next to `AGENTS.md`, etc.) |

When no project is active, writes go to `~/.toby/generated-files/`.

Successful writes return a `fileUrl` and a markdown download link
(`[Download filename](file://…)`). The model includes that link in the reply so
Toby.app can render a **Download** / **Open** chip (save a copy to Downloads, or
open the original with the default app).

## Saving chat attachments

In a project chat, attach a file and explicitly ask Toby to save it to the
project. Toby uses `saveProjectAttachment` to preserve the original bytes under
`<projectFolder>/attachments/<filename>`. This also works for files the current
AI model cannot read. Existing files are never replaced unless the user
explicitly asks to overwrite them.

## Managing project files from chat

To read a PDF already in the project (including
`<projectFolder>/attachments/`), Toby uses **`readPdf`** with the
project-relative path. See [`pdf-read.md`](pdf-read.md).

Project chats expose `listProjectFiles`, `createProjectFolder`,
`renameProjectFile`, and `deleteProjectFile`. Toby uses `listProjectFiles` to
inspect the project tree and identify exact paths before organizing files. To
move an existing file, `renameProjectFile` receives its new project-relative
destination path; create a missing destination folder with
`createProjectFolder` first. These tools require a user’s explicit request and
accept only relative paths inside the project folder. They reject symbolic links
and any path that escapes the project. Moves never replace a destination file
unless the user explicitly requests an overwrite; deletes permanently remove
the requested file.

Paths must be relative, within the base directory, and use an allowed text
extension (`.md`, `.txt`, `.json`, …). See
[`packages/core/src/ai/global-chat-tools.ts`](../packages/core/src/ai/global-chat-tools.ts).

## File layout reference

```text
~/.toby/projects/<slug>/          # default folder (custom paths allowed)
  AGENTS.md                       # project guidance injected into the system prompt
  attachments/                    # original files explicitly saved from project chat
  outputs/                        # generated artifacts from writeTextFile
  .agent/
    skills/
      weekly-format/SKILL.md      # project-local skills
  # Legacy (still recognized where noted):
  # project.json                  # old metadata; migrated into SQLite
  # context/                      # old “inject everything” docs dir (not auto-loaded)
  # skills/                       # old project skills path
```

## Example: weekly overview

1. Create a project in Toby.app named “Weekly Overview”.
2. Edit `AGENTS.md` with tone, sections, and constraints for the weekly report.
3. Optionally add a project skill under `.agent/skills/` for formatting rules.
4. Activate the project on a chat session and ask Toby to generate the overview
   from email/tasks integrations.
5. Generated Markdown lands under `outputs/`.

## Legacy behavior

Older projects used:

- **`project.json`** for name, pinned skills, and integrations — metadata now
  lives in SQLite; on startup Toby migrates folder-based projects into the DB.
- **`context/`** scanned every turn into the system message — **no longer**
  auto-loaded. Put durable instructions in `AGENTS.md` instead.
- **Pinned global skill names / integration lists** on the project row — the
  `Project` type still exposes empty `skills` / `integrations` arrays for old
  callers; prefer project-local skills and normal chat module selection.

## Implementation map

| Concern | Location |
| ------- | -------- |
| Model + CRUD + `AGENTS.md` load | [`packages/core/src/projects/index.ts`](../packages/core/src/projects/index.ts) |
| Active slug in config | [`packages/core/src/config/index.ts`](../packages/core/src/config/index.ts) |
| Prompt injection | [`packages/core/src/prepare-messages.ts`](../packages/core/src/prepare-messages.ts) |
| HTTP API | [`packages/core/src/web/handlers/projects.ts`](../packages/core/src/web/handlers/projects.ts) |
| Configure tree fields | [`packages/core/src/configure/tree.ts`](../packages/core/src/configure/tree.ts) |
| Native UI | Toby.app Projects features / stores |
