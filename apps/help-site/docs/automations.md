---
title: Event automations
---

Automations run a saved flow when you return after inactivity or your Mac wakes.
Use them for a morning briefing, a reminder check when you return to your desk,
or another workflow you already built in **Flows**.

![A disabled welcome-back automation with its conditions and recent runs](/img/toby-app-automations.png)

## Create an automation

1. Create a custom flow in **Flows** and review its steps and delivery targets.
2. Open **Automations** in the sidebar, then choose **New Automation**.
3. Name it and choose **Return after idle** or **Mac wakes**.
4. For an idle trigger, choose the minimum number of minutes without input.
5. Optionally select days, a time window, a timezone, cooldown, or once-per-day.
6. Select your flow and choose whether to notify when it finishes.
7. Review the flow's destinations, turn on **Enabled**, and save.

For example, run a morning briefing when you return after 30 minutes idle, on
weekdays between 08:00 and 12:00, at most once per day.

You can also ask Toby to create an automation for an existing flow. Describe the
trigger, conditions, and whether you want automatic execution enabled.

## Test and inspect

**Preview rule** checks an example event against the saved conditions and
limits. It does not run the flow, send messages, or consume cooldown/daily
limits. A disabled automation reports that it would be skipped.

The detail pane shows recent runs and skipped events. Open a run to see why it
started or was skipped, its saved output, and the flow steps. To run the work
manually, open the selected flow and use its existing run action.

Use **Edit** to change the rule, **Disable** to stop future claims, or **Delete**
to remove it. Saved history remains after deletion. Disabling does not stop a
flow already running.

## What to expect

- **Keep Toby.app running.** Closing its window is fine. Quitting the app stops
  OS observation; events while it is closed are missed. Schedules continue to
  work through the daemon.
- **Idle means no input.** You may still be reading or watching something.
  Detection is sampled every five seconds and starts when observation starts.
- **Wake means system wake.** It does not establish that someone returned or
  unlocked the screen. Return and wake rules are separate automations.
- **Limits count attempted runs.** Cooldown and once-per-day are consumed when
  a run is claimed, even if it later fails. Days follow the selected timezone.
- **No automatic replay.** Events older than two minutes are skipped. Failed or
  interrupted runs are not automatically retried because actions such as email
  delivery may already have happened.
- **No forced pop-up.** Background flows don't open their modal result window.
  Completion notifications can open the saved result when you click them;
  notifications require the usual macOS notification permission.

Schedules are still the place for work that runs at a specific time. Flows
remain reusable work; automations choose when to run them.
