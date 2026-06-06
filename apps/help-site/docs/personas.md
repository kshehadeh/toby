---
sidebar_position: 4
title: Personas
---

# Personas

A **persona** is a named profile that shapes *how* Toby thinks and prioritizes: instructions, AI model, and whether those instructions **add to** or **replace** the base integration prompt.

Personas do not describe step-by-step procedures—that is what [skills](./skills) are for. Together, a persona plus relevant skills let the same task produce different outcomes depending on your lens.

## How personas help

- **Prioritization** — A “technologist” persona cares more about technical threads; a “project manager” persona cares more about schedules and cross-team coordination.
- **Tone and depth** — Instructions can ask for brevity, bullet summaries, or executive-level framing.
- **Model choice** — Each persona can use a different provider and model (for example, a faster model for triage, a larger one for drafting). See [AI providers](./ai-providers/overview) for API keys and recommended models.

## Built-in default: Toby

If you do not set a custom default, Toby uses the built-in **Toby** persona. It includes general assistant behavior and optional categorization guidance (News, Ads, Personal, Career, Creative) when labeling or organizing items.

## Create and edit personas

```bash
toby config
```

Open **Personas**:

- **New Persona** — add a name, instructions, prompt mode, provider, and model
- **Set as default** — the persona used when chat starts
- **Delete** — remove personas you no longer need

Personas are stored in `~/.toby/config.json`.

### Prompt mode

| Mode | Behavior |
| ---- | -------- |
| `add` | Persona instructions are appended to the integration system prompt |
| `replace` | Persona instructions replace the integration system prompt |

Most users start with `add` so integration-specific tool guidance stays intact.

## Use a persona in chat

| Method | How |
| ------ | --- |
| Default | Set default in configure; new sessions use it |
| Switch in chat | `/persona` or **Shift+Tab** |
| One-shot CLI | `toby chat --persona "Technologist"` |

## Example personas

### Technologist

**Instructions (summary):** Prioritize technical subject matter—architecture, bugs, infra, and engineering discussions—over marketing or general admin email.

**Good for:** Inbox triage when you want code and systems topics first.

### Project manager

**Instructions (summary):** Prioritize deadlines, meeting requests, blockers, and messages that affect team coordination or delivery dates.

**Good for:** Standup prep and cross-functional threads.

### Executive assistant

**Instructions (summary):** Be concise; surface only items needing a decision or same-day action; defer low-priority newsletters.

**Good for:** A short daily briefing before meetings.

## Personas vs skills

| | Persona | Skill |
| --- | ------- | ----- |
| Role | Lens and priorities | How to perform a task |
| Storage | `config.json` | `~/.toby/skills/.../SKILL.md` |
| Selection | You choose (default, `/persona`, `--persona`) | Toby picks relevant skills per message |
| Example | “Act like a technologist” | “Steps to organize email by project” |

See [Skills](./skills) and [Examples](./examples) for combined workflows.
