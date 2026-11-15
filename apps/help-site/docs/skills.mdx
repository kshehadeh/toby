---
sidebar_position: 5
title: Skills
---

# Skills

A **skill** teaches Toby how you like a particular task done. For example:
"When I ask for a weekly status update, use the headings Done, In progress,
and Blocked, and keep it under 200 words." Once the skill exists, Toby uses it
whenever a request matches. You don't have to repeat the instructions.

## Create a skill

The easiest way is to ask in chat:

```text
Create a skill for meeting follow-up emails: thank people, list decisions and
owners, and keep it under 150 words.
```

Toby writes the skill and saves it. You can review and edit it in **Skills**
in the sidebar.

## How skills run

On each chat turn, Toby’s pretreatment step may select **relevant** skills from your catalog based on your message. Selected skill bodies are injected into the system prompt for that turn.

You do not pick skills manually each message—Toby chooses from names and summaries in the catalog. Write a clear summary so the right skill is selected.

## Manage skills

### Built-in flow builder

Toby includes an editable **flow-builder** skill to help turn a description into
a reusable [flow](./flows). Try: “Create a Home action that summarizes my upcoming
calendar events.” Toby checks available tools, asks for required details, and
saves the flow without running it. For new AppleScript or TypeScript steps,
Toby can draft the script and guide you through saving it in Script Tools.

The skill appears automatically in your global Skills catalog. You can edit,
disable, or delete it like other skills; Toby preserves those choices.

### Manage in the app

Open **Toby.app** and click **Skills** in the sidebar. The Skills workspace lists
each skill in a second column. Nothing is selected until you choose a skill.
Select one to open its page, or click empty space in the list to clear the
selection. The skill page has **About** and **Instructions** tabs. **About**
shows the icon, name, summary, and enabled state. **Instructions** shows the
markdown body sent to the model. Use toolbar **Edit** to change those fields
in a sheet (**Save** persists, **Cancel** discards). Use **+** in
the toolbar, or the create link when nothing is selected, to open a **New
Skill** sheet (nothing is created until you Save). You can also delete
existing skills from the toolbar.

![Toby.app Skills window](/img/toby-app-skills.png)

### Create on disk (advanced)

Each skill is a Markdown file at `~/.toby/skills/<folder-name>/SKILL.md`. The
skill's summary goes in the frontmatter `description` key:

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

To add a skill manually:

1. Create a folder under `~/.toby/skills/<folder-name>/`.
2. Add a `SKILL.md` file with frontmatter (`name`, plus the skill summary in `description`) and the instructional body.
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

Those skills are available when the project is active. Prefer project-local
skills for procedures that should not apply globally. Global skills under
`~/.toby/skills/` still work for every session.

New projects include a **project-organization** skill that records how that
project's folder is laid out. Toby attaches it on every project chat and updates
it as the layout evolves, so organization stays consistent from chat to chat.

## Related

- [Personas](./personas)
- [Projects](./projects)
- [Examples](./examples)
