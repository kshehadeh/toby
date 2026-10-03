---
sidebar_position: 7
title: Schedules
---

# Schedules

A **schedule** asks Toby to do something automatically at set times, such as
"summarize my unread email every weekday at 8am" or "draft my weekly update
every Friday afternoon."

Each time a schedule runs, Toby handles the request exactly as if you had typed
it into a chat, using the persona (and optionally the project) you picked. A
schedule can also run a saved [flow](./flows) instead of a request.

## Create a schedule from chat

The easiest way is to ask:

```text
Every weekday at 8am, summarize my unread email and list anything that needs a
reply today.
```

```text
On the first of every month, list my overdue tasks and suggest which to drop.
```

Toby creates the schedule and confirms when it will run next.

## Create a schedule in the app

Click **Schedules** in the sidebar, then **+** in the toolbar (or
**File → New Schedule**).

| Field | What to enter |
| ----- | ------------- |
| **Name** | A label you'll recognize, like "Morning inbox check" |
| **When it runs** | **Prompt** to run a request, or **Flow** to run a saved flow |
| **Persona** | Which persona handles the request |
| **Project** | Optional. Run inside a [project](./projects) so results are saved there |
| **Schedule** | When to run. Type it in plain English, such as "every weekday at 8am", and click **Convert** |
| **Prompt** | What Toby should do, written just like a chat message |
| **Enabled** | Turn the schedule on or off without deleting it |

![A schedule's Details tab showing its persona, timing, and recent runs](/img/toby-app-schedules.png)

Select a schedule to see its details and **Recent runs**. Click a run to read
what Toby did and what it answered.

## Keep Toby running

Schedules only run while Toby is open (it can be in the background). To make
sure nothing is missed, turn on **Start at login** in **Settings → General**.

If a schedule didn't run, check that Toby is open and the status dot at the
bottom of the sidebar is green. Click the dot and choose **Restart server** if
it isn't.

## Test a schedule

Select a schedule and click **Run now** (▶) in the toolbar to run it right
away. That's the quickest way to check the prompt does what you expect.

## Tips

- Connect the apps your request needs (Email, Todoist, and so on) first.
- Ask for exactly what you want to see, such as "short bullets" or "only items
  due this week", so the result is easy to skim.
- To get results somewhere other than Toby, say so in the prompt: "…and email
  the summary to me" or "…and post it to #team in Slack."
- When a schedule runs a flow, the flow's email and Slack destinations still
  send, but no result window pops up.

## Advanced: cron expressions

Under the hood, the **Schedule** field is a standard five-part cron
expression, such as `0 8 * * 1-5` for weekdays at 8:00. You can type one
directly instead of using **Convert**. Times use your Mac's time zone.

## Related

- [Flows](./flows): recipes you can also run on a schedule
- [Projects](./projects): keep a recurring report's history in one place
- [Things to try](./examples)
