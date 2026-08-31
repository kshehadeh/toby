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

### Manage in the app

Open **Toby.app** and click **Skills** in the sidebar. The Skills view opens with
an overview of your skills as cards. Select a card or a skill in the sidebar to
view and edit it. Use **New Skill** in the toolbar while viewing the overview
to create one. You can also delete existing skills and run a skill directly
from the toolbar.

![Toby.app Skills window](/img/toby-app-skills.png)

### Draft from chat

In chat, ask Toby to create a skill. For example: “Create a skill that documents how I run weekly email cleanup.” Toby can draft a full `SKILL.md` and save it under `~/.toby/skills/`.

### Create on disk (advanced)

You can also add a skill manually:

1. Create a folder under `~/.toby/skills/<folder-name>/`.
2. Add a `SKILL.md` file with frontmatter (`name`, `description`) and the skill body.
3. Open the **Skills** window in Toby.app to confirm it appears in the list.

## Skills vs personas

| | Persona | Skill |
| --- | ------- | ----- |
| **Purpose** | Who Toby is being (priorities, tone) | What procedure to follow |
| **Storage** | `~/.toby/config.json` | `~/.toby/skills/<name>/SKILL.md` |
| **Selection** | You set default or switch via the persona picker | Toby selects per message from catalog |
| **Example** | “Prioritize engineering email” | “How to label and archive by project” |

The same skill with different personas can produce different prioritization—for example, an email-organize skill under a technologist vs project manager persona (see [Examples](./examples)).

## Project-local skills

A [project](./projects) can include skills under its own folder:

```text
~/.toby/projects/<project-id>/.agent/skills/<skill-name>/SKILL.md
```

Those skills load automatically when the project is active. Prefer project-local
skills for procedures that should not apply globally. Global skills under
`~/.toby/skills/` still work for every session.

## Related

- [Personas](./personas)
- [Projects](./projects)
- [Examples](./examples)
