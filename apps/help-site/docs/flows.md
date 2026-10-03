---
sidebar_position: 7.5
title: Flows
---

# Flows

A **flow** is a fixed recipe Toby follows step by step: gather information
from your apps, optionally have AI write it up, then deliver the result. Unlike
a chat, a flow does the same thing the same way every time, so it suits
routines you run often.

Use a flow when you want:

- **A one-click button on Home.** For example, "Focus mode" turns off Wi‑Fi
  and minimizes every window.
- **A live card on Home.** For example, "Top Jira issues assigned to me",
  refreshed whenever you open Toby.
- **A result sent somewhere.** For example, a daily task digest emailed to you
  or posted to Slack, run by a [schedule](./schedules).

The built-in **Upcoming**, **Tasks**, and **Unread mail** cards on
[Home](./toby-app#home) are flows too.

## Build a flow from a description

Ask Toby in chat, for example: “Create a Home action that summarizes my upcoming
calendar events.” The built-in **flow-builder** skill checks available tools,
collects any required details, and saves a custom flow. Open **Flows** to review
or run it. Home actions also appear in the **Actions** rail.

Saving does not run the flow. Tool arguments must be fixed when you build it,
and an optional LLM step runs last. For a new AppleScript or TypeScript step,
Toby can draft the code and guide you through saving it in **Script Tools**
before adding it to the flow.

Changing a flow's destination to a dashboard card preserves its existing steps
and the data passed to its LLM prompt. Refreshing the card runs the saved flow.

## What flows are for

| Piece | Role |
| ----- | ---- |
| **Local tools** | Read or act on connected services (unread mail, open tasks, upcoming events, and so on) |
| **Persona** | Supplies the model, tone, and priorities for any LLM step |
| **LLM step** | Turns tool results into prose or structured output (for example a markdown summary) |

Unlike chat, a flow does not improvise a multi-step tool loop. It runs a **defined sequence** of steps so the same job behaves consistently every time.

## Built-in flows (dashboard)

The flows that ship with Toby are **built-in** and power the Home cards:

| Dashboard block | What the built-in flow does |
| --------------- | --------------------------- |
| **Email** | Loads unread-style email items from your email integration, then summarizes them for the card |
| **Tasks** | Loads open tasks, then summarizes what needs attention |
| **Calendar** | Loads upcoming events, then summarizes what’s coming up |

Those pipelines use the **Home persona** (configured under **Settings → Home**) for their model and writing style. Connect the matching [integrations](./integrations/overview), leave Toby running, and Home can refresh those blurbs automatically.

## Browse flows in Toby.app

Open **Toby.app** and choose **Flows** from the sidebar (or the View menu / menu bar).

![Toby.app Flows](/img/toby-app-flows.png)

From there you can:

- See **all flows** in the workspace list (nothing is selected until you choose one)
- Select a flow to open its page, or click empty space in the list to clear the selection
- On **Details**, inspect description, steps (tool + model nodes), metadata, and finish destinations
- Switch to **Recent runs** for history, and open a run for status, timing, and per-step detail

Built-in flows are labeled and are **read-only** in the UI.

## Create your own flow

Click **+** in the Flows toolbar. The **New flow** sheet walks you through
three parts: what the flow **gathers and acts** on, what the AI **thinks**
about it, and where the answer is **shared**. Nothing is created until you
click **Save**.

![The New flow sheet with Name, Look, and the Gathers and acts, Thinks, and Shares sections](/img/toby-app-flow-builder.png)

1. **Name and look.** Give the flow a name and a one-line description, then
   pick an icon and color under **Look**. The color is used for its Home button
   (teal if you skip it).
2. **Gathers and acts.** Click **Add a source** to add steps that read from
   or act on your apps (tasks, calendar, mail, macOS controls, or your own
   [script tools](#reuse-a-script-in-several-flows)). Fill in any settings a
   step needs, such as Wi‑Fi on or off, when you add it.
3. **Thinks.** Optionally click **Add an AI step** and describe what the AI
   should do with what was gathered, for example "List the three most urgent
   items in one line each."
4. **Shares.** Choose where the result goes. **Show it in a window** is the
   default. You can add or swap in:
   - **Email** or **Slack** (that app must be connected)
   - **Home**, as either:
     - **A card** that shows the latest result. **As Needed** (default)
       refreshes it when you open Home and the last run is more than a few
       minutes old. **Manual** refreshes only when you click refresh.
     - **A button** in the **Actions** strip that runs the flow when you
       click it. Hover over a button to see its name and description.
5. Click **Save**, then **Run now** to try it.

You can combine a dashboard card with a result window (or email / Slack). A
flow can have only one Dashboard destination. Email and Slack still send when
you **Run now** or when a schedule fires — not when the home card refreshes.

A good first flow is a focus macro: turn Wi-Fi off, then minimize all windows. Tools that need IDs from a previous search (for example “archive these messages”) still belong in [chat](./getting-started/first-chat) or a [schedule](./schedules) prompt — the model can pick IDs and call the tool itself.

To run a flow on a timetable, open **Schedules**, set **When it runs** to
**Flow**, and pick the flow. See [Schedules](./schedules).

### Home color

In a flow's dashboard output settings, use **Home color** to choose the default
appearance of its Home card or Actions tile. The palette includes teal, blue,
green, orange, purple, pink, red, and gray. **Neutral** removes color;
**Automatic** keeps the existing appearance (neutral cards, or the flow color
for Actions tiles).

Colored cards have a border in the selected color and a subtle background tint
that adapts to light and dark mode. Save the flow to apply its default. You can
choose a different color for that block through **Edit Home**; that override is
saved only on this Mac. Choose **Use default** there to follow the flow again.

### Reuse a script in several flows

Open **Script Tools** from the Flows list, then choose **New Tool**. Give the
tool a name, choose TypeScript or AppleScript, add a named row for each string
input, and choose text or JSON output. The code editor shows line numbers and
colors TypeScript and AppleScript syntax. Enter example
values in the matching **Test inputs** fields and choose **Run Test** at any
time, including before saving a new tool or edits. Testing does not save changes.
Choose **Save Tool** when you're ready to make the script available to flows.
In a flow's **Add tool**
picker, your scripts appear under **My Tools**.

To draft or revise a script with AI, choose **Edit with AI** above the editor.
Describe what to build, then enter follow-up requests such as “add an error
message when the input is empty.” Each request uses the latest editor code,
tool settings, and recent requests as context. Toby replaces the editor code
with the result, so review it before you test or save. You can edit the code
yourself between requests. The request history lasts only while this tool is
open in the editor. AI editing supports code up to 20,000 characters. AI edits
do not run or save the script.

TypeScript tools export a default async function that receives an object of
named inputs and returns the output. AppleScript tools use `on run argv`; the
inputs arrive as strings in the order you listed them. For JSON output,
AppleScript must return a JSON string. Editing a saved script changes what all
flows using it run. The library shows how many flows use each tool, and it
won't delete a tool while a flow references it. Scripts run with your macOS
user permissions, so review code before saving and testing it.

## Advanced

### Use step data in an AI step

Tool steps show the reference you can copy into a prompt. The LLM step's
**Insert step output** menu inserts one for you. For example,
`{{json bag.jiraIssues}}` includes the Jira data when a step saves its output as
`jiraIssues`. The reference uses the saved output name, which can differ from
the step's name. When multiple steps share a reference, the last step's data is
used.

To inspect the actual data, open a flow's **Recent runs**, select a run, and
expand the step's **Outputs** under **Nodes**. The Jira search output includes an
`issues` array. An LLM output saved as `summary` is displayed from
`summary.markdown`; flow creation now checks that the requested result exists
in the step outputs.

## Flows vs chat vs schedules

| | **Chat** | **Flow** | **Schedule** |
| --- | -------- | -------- | ------------ |
| **How it runs** | Interactive conversation with tools chosen per turn | Fixed pipeline of tool + model steps | Fires a prompt **or a flow** on a cron |
| **Best for** | Open-ended questions and multi-step work | Repeatable summaries and automated workflows | “Do this every morning” |

## Tips

- Connect Email, tasks, and Calendar integrations so dashboard flows have something useful to summarize.
- Tune **Settings → Home** for the persona used by Home AI blurbs.
- Use the **Flows** window when you want to see *why* a dashboard blurb looks the way it does (which tools ran, and recent history).
- For a first custom flow, start with tools whose arguments you already know (Wi-Fi off, volume, minimize all). Leave “pick these emails and archive them” to chat.

## Related

- [Toby.app](./toby-app) — Home, Flows window, and settings
- [Personas](./personas) — Model and instructions used by LLM steps
- [Schedules](./schedules) — Run a prompt or a flow on a timetable
- [Integrations](./integrations/overview) — Local tools flows call
