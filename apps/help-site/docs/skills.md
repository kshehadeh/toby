---
sidebar_position: 5
title: Skills
---

# Skills

**Skills** are reusable instructions Toby loads when they match what you are trying to do. Each skill is a markdown file with YAML frontmatter, stored on disk under your Toby config directory.

## What skills are

A skill lives at:

```text
~/.toby/skills/<folder-name>/SKILL.md
```

The file has:

1. **Frontmatter** — at minimum `name` and `description` (used to decide when the skill applies)
2. **Body** — markdown with steps, rules, or domain knowledge

Example:

```markdown
---
name: organize-email-by-project
description: Steps to triage email into project labels and archive noise.
---

# Organize email by project

1. Search unread messages from the last 7 days.
2. Group by project name mentioned in the subject or body.
3. Suggest one label per project; ask before applying changes.
4. Archive promotional mail older than 30 days unless starred.
```

## How skills run

On each chat turn, Toby’s pretreatment step may select **relevant** skills from your catalog based on your message. Selected skill bodies are injected into the system prompt for that turn.

You do not pick skills manually each message—Toby chooses from names in the catalog. Use a clear `description` so the right skill is selected.

## Add and manage skills

### Create on disk

```bash
mkdir -p ~/.toby/skills/organize-email
# Edit ~/.toby/skills/organize-email/SKILL.md
```

### Manage in the app

Open **Toby.app** and click **Skills** in the sidebar. The Skills window lists installed skills with descriptions. You can add new skills, delete existing ones, and run a skill directly from the toolbar.

In the terminal, run `toby skills` to list, view, edit (opens your editor), and delete skills. In chat, type **`/skills`** to open the same manager.

There is no in-app “new skill wizard”—create the folder and `SKILL.md` file first, then refresh via chat or `toby skills`.

### Draft from chat (advanced)

In chat, Toby can use the **createLocalSkill** tool to draft a full `SKILL.md` and save it under `~/.toby/skills/`. Ask explicitly, for example: “Create a skill that documents how I run weekly email cleanup.”

## Skills vs personas

| | Persona | Skill |
| --- | ------- | ----- |
| **Purpose** | Who Toby is being (priorities, tone) | What procedure to follow |
| **Storage** | `~/.toby/config.json` | `~/.toby/skills/<name>/SKILL.md` |
| **Selection** | You set default or switch via the persona picker | Toby selects per message from catalog |
| **Example** | “Prioritize engineering email” | “How to label and archive by project” |

The same skill with different personas can produce different prioritization—for example, an email-organize skill under a technologist vs project manager persona (see [Examples](./examples)).

## Pinning skills to a project

A [project](./projects) can declare **pinned skills** — skills that are relevant to that project's recurring workflow. Pinning makes the association explicit so you remember which skills to use, and the project detail view shows them at a glance.

To pin a skill: open **Toby.app → Settings → Projects**, select the project, and enter comma-separated skill names in the **Skills** field.

## Debug skill selection

```bash
toby chat --debug
```

Shows the skill catalog and which skills pretreatment selected for the turn.

## Related

- [Personas](./personas)
- [Projects](./projects)
- [Examples](./examples)
