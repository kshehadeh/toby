---
sidebar_position: 8
title: Examples
---

# Examples

These workflows combine integrations, personas, skills, memories, and schedules the way Toby is designed to be used.

## Morning email triage (Gmail)

**Setup:** [Gmail connected](./integrations/gmail), [AI configured](./getting-started/setup-ai), default **Toby** persona.

**Chat:**

```text
Summarize my unread Gmail from the last 24 hours. List anything that needs a reply today and suggest archive or label actions.
```

**Outcome:** One pass over the inbox with actionable next steps.

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

## macOS local mail search and draft

**Setup:** [Apple Mail](./integrations/apple-mail) connected, Automation permission granted.

**Chat:**

```text
Search unread mail in my Work account from the last three days about the budget. Draft a short reply to the most recent thread saying I'll review the spreadsheet today.
```

**Outcome:** Local Mail.app search and draft tools—no Gmail API required.

---

## Daily automated brief

**Setup:** Gmail connected, [daemon running](./schedules), schedule created in `toby schedules`.

| Field | Value |
| ----- | ----- |
| Name | Daily brief |
| Prompt | Summarize unread Gmail; list replies needed today. |
| Persona | Toby |
| Cron | `0 9 * * *` |

**Outcome:** Hands-free morning summary at 9am.

---

## Where to go next

- [Getting Started](./getting-started/install)
- [Integrations](./integrations/overview)
- [Personas](./personas) · [Skills](./skills) · [Memories](./memories) · [Schedules](./schedules)
