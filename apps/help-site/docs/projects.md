---
sidebar_position: 5.5
title: Projects
---

# Projects

**Projects** give Toby a durable workspace for a specific body of work. A project has its own folder, instructions, project chats, generated outputs, optional persona, and project-local skills so related work stays together across sessions.

![Toby.app Projects workspace](/img/toby-app-projects.png)

## What a project is

A project is a record in Toby's local session database backed by a folder under `~/.toby/projects/`. New projects use a stable project id for the folder name, and Toby.app exposes the exact path from the project page.

```text
~/.toby/projects/<project-id>/
  AGENTS.md          # project instructions read by project chats
  .agent/skills/     # project-local skills
  outputs/           # generated artifacts
```

When you work inside a project, Toby uses the project metadata and folder contents to keep the chat grounded:

1. **Project guidance** — `AGENTS.md` is included as project-specific instruction.
2. **Project-local skills** — every `SKILL.md` under `.agent/skills/` is loaded automatically for that project.
3. **Output scoping** — generated files land in the project's `outputs/` folder by default.
4. **Project chat grouping** — project chats belong to the project. Open the project page to start a new chat or continue a recent one.

This makes projects ideal for recurring workflows like weekly overviews, monthly reports, or any task where you want the AI to produce consistent output informed by the same reference material each time.

## Create a project

In Toby.app, open **Projects** from the sidebar and click **+** in the toolbar (shown when no project is selected), or use **Create Project** on the empty Projects page. Toby creates the project folder, selects the project, and opens the project page.

## Project workspace

On **Home**, the left sidebar lists the five most recently updated projects.
Click one to open its project page.

The Projects area has a sidebar list and a main page:

| Area | What it does |
| ---- | ------------ |
| Project sidebar | Lists each project by name, with chat count and persona underneath. Select a project to open it. Right-click a project to choose from its ten most recently updated chats and open one directly. Press ⌘N while a project is selected to start a new project chat. Click **Projects** to return to the all-projects view. |
| All projects | Shown when nothing is selected. Projects appear as cards, or an empty state with **Create Project** if you have none yet. The toolbar **+** creates a new project. |
| Project page | The selected project's details: a prominent **New Chat** button, the last five chats, name, summary, persona, folder path, and file tree. The toolbar switches to **New Chat** and **Delete**. |
| Project chat | Opens in the main area when you start or resume a project chat. A Files sidebar opens on the right and refreshes as the chat creates, updates, or deletes files. Changed files are briefly labeled, including recently deleted files. Use the toolbar Files button to hide or show it. The toolbar also shows a folder icon and a **Back to Project** button; the project stays highlighted in the sidebar. Select the project or use that button to return to its details. |

The project persona is optional. When set, new project chats use that persona by default, which is useful when a project always needs a specific voice or role.

## Add project instructions

Every project starts with an `AGENTS.md` file:

```text
~/.toby/projects/<project-id>/AGENTS.md
```

Use this file for durable guidance that should apply to all project chats: goals, conventions, customer context, output formats, or source-of-truth links.

## Add project-local skills

Skills placed in the project's `.agent/skills/` directory are loaded automatically whenever that project is active:

```text
~/.toby/projects/<project-id>/.agent/skills/
  weekly-update-format/SKILL.md
```

Ask Toby to create a skill while working in a project, or add a `SKILL.md` manually. Project-local skills are best for instructions that should not apply globally.

Global skills under `~/.toby/skills/` still work normally. Use project-local skills when the behavior belongs only to one project.

## Browse project files

The project page shows the project file tree. Use it to confirm that generated outputs and skills landed in the right place. The folder row reveals the project folder in Finder, and files in the tree can be opened with their default app.

Generated files are written to:

```text
~/.toby/projects/<project-id>/outputs/
```

When no project is active, generated files fall back to `~/.toby/generated-files/`.

### Save an attached file to a project

In a project chat, use the **+** button to attach a file, then explicitly ask
Toby to save it to the project, for example: “Save this brief to the project.”
Toby stores the original file in the project's `attachments` folder. This also
works for files your selected AI model cannot read. Toby will not replace a file
with the same name unless you explicitly ask it to overwrite the existing file.

### Organize, move, rename, or delete project files

In a project chat, Toby can inspect the project files before organizing them.
Ask Toby to create folders, move or rename a file, or delete a file already in
the project. For example: “Create a `references/designs` folder,” “Move
`attachments/brief.pdf` to
`references/designs/final-brief.pdf`,” or “Delete `outputs/old-report.md`.”
Toby only acts on your explicit request, uses paths inside the project folder,
and will not replace an existing destination file unless you ask it to
overwrite that file. Deletions permanently remove the requested file.

When Toby writes a file in chat, the reply includes a download chip. **Download**
saves a copy to your Downloads folder and reveals it in Finder; **Open** opens
the original with its default app. You can also **Save As…** or **Reveal in
Finder** from the chip’s context menu.

## Use projects with schedules

Schedules can be associated with a project. When a scheduled prompt runs with a project selected, Toby uses that project's guidance and writes generated artifacts to the project workspace.

This is useful for recurring reports, weekly reviews, customer updates, and other repeated workflows that should keep the same context over time.

## Legacy context folders

Older Toby project folders may contain a `context/` directory or `project.json`. Toby migrates legacy projects into the current project database and keeps the old paths available for compatibility, but new project guidance should go in `AGENTS.md` and project-local skills should go under `.agent/skills/`.

## Example: weekly overview project

```text
# 1. Create the project
Toby.app → Projects → + → rename to "Weekly Updates"

# 2. Add durable guidance
Open the project folder from the project page and edit AGENTS.md.

# 3. Create a skill for consistent formatting
"Create a skill called weekly-overview-format that formats a weekly status
 update with sections: Accomplishments, Blockers, Priorities Next Week.
 Write it in a concise bullet-point style."

# 4. Keep the skill project-local
Save the skill under .agent/skills/weekly-overview-format/SKILL.md.

# 5. Generate each week
"Generate this week's overview based on my recent emails and tasks"
→ output lands in the project's outputs/ folder.
```

Over time, the `outputs/` folder accumulates each weekly overview, all produced with the same style and project instructions.

## Projects vs chat history

| | Chat session | Project |
| --- | ------------ | ------- |
| **Stores** | Conversation transcript | Instructions, skills, and generated artifacts |
| **Primary location** | `~/.toby/chat.sqlite` | `~/.toby/projects/<project-id>/` |
| **Lifespan** | Per session | Until you delete the project |
| **AI access** | Prior messages | Project guidance and project-local skills |

## Related

- [Skills](./skills) — reusable instructions, including project-local skills
- [Personas](./personas) — who Toby is being (complements project guidance)
- [Memories](./memories) — durable facts, separate from project guidance
- [Schedules](./schedules) — automate recurring project workflows
