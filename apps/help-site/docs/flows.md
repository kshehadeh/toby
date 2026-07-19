---
sidebar_position: 7.5
title: Flows
---

# Flows

**Flows** are automated pipelines that combine your **local tools** (integrations such as Email, tasks, and Calendar) with a **persona** and an **LLM** to produce a result without a full free-form chat turn.

Think of a flow as a fixed recipe: fetch data with tools, then have the model write a short summary or transform that data under the persona’s instructions and model choice. That makes flows well suited for reliable, repeatable workflows—especially the short AI blurbs on the home [dashboard](./toby-app#dashboard-related).

## What flows are for

| Piece | Role |
| ----- | ---- |
| **Local tools** | Read or act on connected services (unread mail, open tasks, upcoming events, and so on) |
| **Persona** | Supplies the model, tone, and priorities for any LLM step |
| **LLM step** | Turns tool results into prose or structured output (for example a markdown summary) |

Unlike chat, a flow does not improvise a multi-step tool loop. It runs a **defined sequence** of steps so the same job behaves consistently every time.

## Built-in flows (dashboard)

Today, the flows that ship with Toby are **built-in** and power the **home dashboard** cards:

| Dashboard block | What the built-in flow does |
| --------------- | --------------------------- |
| **Email** | Loads unread-style email items from your email integration, then summarizes them for the card |
| **Tasks** | Loads open tasks, then summarizes what needs attention |
| **Calendar** | Loads upcoming events, then summarizes what’s coming up |

Those pipelines use the **Dashboard persona** (configured under **Settings → Dashboard**) for their model and writing style. Connect the matching [integrations](./integrations/overview), leave Toby running, and the dashboard can refresh those blurbs automatically.

## Browse flows in Toby.app

Open **Toby.app** and choose **Flows** from the sidebar (or the View menu / menu bar).

From there you can:

- See **all flows** as cards on the home screen
- Select a flow to inspect its **steps** (tool + model nodes)
- Review **recent runs** and open a run for status, timing, and per-step detail

Built-in flows are labeled and are **read-only** in the UI.

## Customization status

**Flows are not customizable yet.** You cannot create, edit, or delete your own flows in the current release. That limitation is **temporary**.

**Coming later:**

- Create and edit **your own** flows
- Run custom flows on a [schedule](./schedules) so automated workflows fire on a timetable (alongside or instead of free-form schedule prompts)

Until then, use the built-in dashboard flows as they are, and use [schedules](./schedules) for recurring chat-style prompts.

## Flows vs chat vs schedules

| | **Chat** | **Flow** | **Schedule** |
| --- | -------- | -------- | ------------ |
| **How it runs** | Interactive conversation with tools chosen per turn | Fixed pipeline of tool + model steps | Fires a prompt (or, later, a flow) on a cron |
| **Best for** | Open-ended questions and multi-step work | Repeatable summaries and automated workflows | “Do this every morning” |
| **Today** | Fully available | Built-in dashboard flows only | Recurring prompts with a persona |

## Tips

- Connect Email, tasks, and Calendar integrations so dashboard flows have something useful to summarize.
- Tune **Settings → Dashboard** for the persona used by dashboard AI blurbs.
- Use the **Flows** window when you want to see *why* a dashboard blurb looks the way it does (which tools ran, and recent history).

## Related

- [Toby.app](./toby-app) — Dashboard, Flows window, and settings
- [Personas](./personas) — Model and instructions used by LLM steps
- [Schedules](./schedules) — Recurring automation (future home for custom flows)
- [Integrations](./integrations/overview) — Local tools flows call
