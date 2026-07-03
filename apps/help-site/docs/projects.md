---
sidebar_position: 5.5
title: Projects
---

# Projects

**Projects** collect AI-generated artifacts in one place over time, with their own reference context and pinned skills so outputs stay consistent across sessions.

## What a project is

A project is a folder under `~/.toby/projects/` that holds reference documents, generated outputs, and metadata:

```text
~/.toby/projects/weekly-overview/
  project.json       # name, pinned skills, pinned integrations
  context/           # reference documents the AI reads every turn
  outputs/           # generated artifacts (reports, summaries, etc.)
```

When a project is **active**, two things happen automatically on every chat turn:

1. **Context injection** — files in `context/` are loaded into the system prompt so the AI has the same reference material every time.
2. **Output scoping** — `writeTextFile` writes to the project's `outputs/` folder by default, keeping all generated artifacts together.

This makes projects ideal for recurring workflows like weekly overviews, monthly reports, or any task where you want the AI to produce consistent output informed by the same reference material each time.

## Create a project

In chat, type `/project` and select **Add Project**. Toby prompts you for a name, creates the folder structure, and activates it.

You can also create a project through **Toby.app → Settings → Projects**.

## Activate and switch projects

Type `/project` in chat to open the project picker:

- **Select a project** and press **Enter** or **a** to activate it.
- **Clear** — deactivate the current project (output reverts to `~/.toby/generated-files/`).
- **Add** — create a new project.

Activating a project reboots the session so context documents are injected fresh.

## Project detail view

After selecting a project in the picker, the detail modal shows:

| Section | What it shows |
| ------- | ------------- |
| **Context files** | Reference documents the AI reads every turn |
| **Output files** | Generated artifacts stored in the project |
| **Pinned skills** | Local skills relevant to this project |
| **Context integrations** | Integrations whose data is relevant to the project |

Press **e** to edit the project in Settings, or **Esc** to go back.

## Edit a project

From the detail view press **e**, or navigate to **Toby.app → Settings → Projects** and select the project name. Editable fields:

| Field | Description |
| ----- | ----------- |
| **Name** | Display name |
| **Skills** | Comma-separated local skill names to pin to this project |
| **Integrations** | Comma-separated integration names to associate with this project |
| **Delete project** | Removes the project folder and all its contents |

### Add reference context

Place any text file into the project's `context/` directory:

```bash
cp style-guide.md ~/.toby/projects/weekly-overview/context/
```

Supported extensions: `.md`, `.markdown`, `.txt`, `.text`, `.json`, `.yaml`, `.yml`, `.csv`, `.tsv`, `.log`, `.xml`, `.html`, `.rst`.

Files larger than 64 KB are skipped. Total context is capped at 256 KB per turn. Subdirectories up to 6 levels deep are supported. Dot-prefixed files and symlinks are ignored.

## Write files within a project

When a project is active, the `writeTextFile` tool scopes output to the project:

| Location | Destination |
| -------- | ----------- |
| `outputs` (default) | `~/.toby/projects/<slug>/outputs/` |
| `context` | `~/.toby/projects/<slug>/context/` |

Use `context` when you want the AI to read the file in future turns. Use `outputs` (the default) for generated artifacts that do not need to be re-read.

When no project is active, `writeTextFile` falls back to `~/.toby/generated-files/`.

## Pinned skills

Each project can declare **pinned skills** — local skills from `~/.toby/skills/` that are relevant to the project's workflow. For example, a project that generates weekly email digests might pin a skill like `email-triage` that provides formatting and prioritization instructions.

To create a new skill for a project, ask in chat: *"Create a skill for weekly email summaries"* — Toby drafts a `SKILL.md` under `~/.toby/skills/` using the `createLocalSkill` tool. You can then pin it to the project via **Toby.app → Settings → Projects**.

See [Skills](./skills) for more on creating and managing skills.

## Example: weekly overview project

```text
# 1. Create the project
/project  →  Add Project  →  name: "Weekly Overview"

# 2. Add reference context
# (from a terminal)
cp last-weeks-overview.md ~/.toby/projects/weekly-overview/context/
cp team-goals.md ~/.toby/projects/weekly-overview/context/

# 3. Create a skill for consistent formatting
"Create a skill called weekly-overview-format that formats a weekly status
 update with sections: Accomplishments, Blockers, Priorities Next Week.
 Write it in a concise bullet-point style."

# 4. Pin the skill to the project
# In Toby.app → Settings → Projects → weekly-overview → Skills: weekly-overview-format

# 5. Generate each week
"Generate this week's overview based on my recent emails and tasks"
 → output lands in ~/.toby/projects/weekly-overview/outputs/
```

Over time, the `outputs/` folder accumulates each weekly overview, all produced with the same style and informed by the same reference documents.

## Projects vs chat history

| | Chat session | Project |
| --- | ------------ | ------- |
| **Stores** | Full conversation transcript | Reference context + generated artifacts |
| **File** | `~/.toby/chat.sqlite` | `~/.toby/projects/<slug>/` |
| **Lifespan** | Per session | Until you delete the project |
| **AI access** | Prior messages | Context docs injected every turn |

## Related

- [Skills](./skills) — reusable instructions that projects can pin
- [Personas](./personas) — who Toby is being (complements what a project's context provides)
- [Memories](./memories) — durable facts, separate from project context
- [Schedules](./schedules) — automate recurring project workflows
