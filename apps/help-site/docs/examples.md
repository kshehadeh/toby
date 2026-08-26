---
sidebar_position: 8
title: Examples
---

# Examples

These workflows combine integrations, personas, skills, memories, and schedules the way Toby is designed to be used.

## Morning email triage (Email)

**Setup:** [Email connected](./integrations/email), [AI configured](./getting-started/setup-ai), then start the chat with [**Mailman**](./personas#mailman) from the **+** menu (or set Mailman as your default).

**Chat:**

```text
Summarize my unread email from the last 24 hours. List anything that needs a reply today and suggest archive or label actions.
```

**Outcome:** One pass over the inbox grouped by Needs attention / Worth noting / Ignore, with category labels and next steps.

---

## Technologist vs project manager lens

**Setup:** Two [personas](./personas)—**Technologist** and **Project Manager**—plus a [skill](./skills) such as `organize-email-by-project` that describes how to triage mail.

**Chat (Technologist):**

```text
/persona
Organize my inbox using the project skill—prioritize technical threads first.
```

**Chat (Project Manager):** Same prompt with the PM persona selected.

**Outcome:** The same skill runs, but prioritization differs: engineering depth vs deadlines and coordination.

---

## Weekly standup prep (Todoist + Slack)

**Setup:** [Todoist](./integrations/todoist) and [Slack](./integrations/slack) connected.

**Chat:**

```text
List my Todoist tasks due this week and summarize Slack mentions of my handle in #engineering since Monday.
```

**Optional schedule:** [Schedule](./schedules) `0 8 * * 1` (Mondays 8am) with prompt “Standup prep: tasks due this week plus Slack highlights from #engineering.”

---

## Sprint health check (Jira)

**Setup:** [Jira](./integrations/jira) connected.

**Chat:**

```text
Find unresolved Jira bugs assigned to me in the current sprint. Group them by priority and call out anything blocked.
```

**Outcome:** A read-only issue summary using Jira search, issue details, and comments.

---

## Research a URL and the web

**Setup:** AI configured. For web search, [Web Search](./configuration/web-search) enabled (Vercel AI Gateway key + Settings → Web Search).

**Chat:**

```text
Search the web for recent changes to the vendor API, then read https://example.com/changelog and summarize what affects us.
```

**Outcome:** Toby can combine web search results with direct URL reading.

---

## Capture meeting notes in chat

**Setup:** macOS audio helper available for [listen mode](./listen).

**Chat:**

```text
/listen
```

After the meeting:

```text
/stop-listening
Summarize the transcript and list action items by owner.
```

**Outcome:** The recording is saved, transcribed, and added to chat context.

---

## Remember preferences after calendar work

**Setup:** [Apple Calendar](./integrations/apple-calendar) connected on macOS.

**Chat:**

```text
Look at my meetings tomorrow. Remember that I prefer calls before noon when possible.
```

**Later:**

```text
What do you know about my meeting preferences?
```

**Outcome:** Toby proposes a memory; after you confirm (if needed), later sessions reuse it.

---

## Daily automated brief

**Setup:** Email connected, Toby.app running so schedules can fire, and a schedule created in **Toby.app → Schedules**.

| Field | Value |
| ----- | ----- |
| Name | Daily brief |
| Prompt | Summarize unread email; list replies needed today. |
| Persona | Toby |
| Cron | `0 9 * * *` |

**Outcome:** Hands-free morning summary at 9am.

---

## Recurring weekly overview (Projects)

**Setup:** [Email](./integrations/email) or [Todoist](./integrations/todoist) connected, a [project](./projects) created in Toby.app.

**Create the project:**

```text
Toby.app → Projects → + → rename to "Weekly Overview"
```

**Add durable guidance:** Open the project folder from the project page (Reveal in Finder), then edit `AGENTS.md` with goals, tone, and required sections for the weekly overview.

**Create a project-local skill** for consistent formatting (in a project chat):

```text
Create a skill called weekly-overview-format that formats a weekly status
update with sections: Accomplishments, Blockers, Priorities Next Week.
```

Save it under the project’s `.agent/skills/` folder so it loads only for that project.

**Chat each week** (with the project active):

```text
Generate this week's overview based on my recent emails and tasks.
```

**Outcome:** Every weekly overview lands in the project's `outputs/` folder, formatted consistently and guided by `AGENTS.md` / project skills.

**Optional schedule:** [Schedule](./schedules) `0 9 * * 1` (Mondays 9am) with the same prompt and project for a fully automated weekly brief.

---

## Where to go next

- [Getting Started](./getting-started/install)
- [Integrations](./integrations/overview)
- [Personas](./personas) · [Skills](./skills) · [Memories](./memories) · [Projects](./projects) · [Schedules](./schedules)
