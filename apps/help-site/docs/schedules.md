---
sidebar_position: 7
title: Scheduled flows
---

# Scheduled flows

A schedule is a trigger on a [Flow](./flows). Open **Flows**, create or edit a
flow, and add a trigger in **When**. Choose **On a schedule**, enter a cron
expression and timezone, then enable the trigger and save.

For example, `0 8 * * 1-5` runs at 8am Monday through Friday. Keep a **Manually**
trigger if you also want **Run Now**. Each trigger has independent inputs,
conditions, cooldown, once-per-day limit, and completion notification setting.

For a request such as “summarize my unread email every morning,” add an
**Agent Task** AI step and enter the request. Agent Tasks can choose tools and
use the selected persona, skills, memory, and optional project context. They
cannot ask follow-up questions while running. You can also ask Toby in chat to
create this Flow.

Choose **Run the latest missed occurrence** to catch up once after downtime,
or **Skip occurrences more than a minute late**. The daemon must be running.
Saving an enabled trigger permits future automatic execution, including its
actions and delivery destinations.

Open **Trigger activity** to see runs and skips; open a linked run to inspect
its steps. Enable **Notify when finished** if you want a completion notification.

The separate Schedules screen and `toby schedules` command have been removed.
Legacy schedules are not imported automatically; recreate them as Flows.
