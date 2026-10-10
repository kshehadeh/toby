---
title: Event automations
---

Automations run a saved flow when you return after inactivity, your Mac wakes, or files in a folder change.
Use them for a morning briefing, a reminder check when you return to your desk,
or another workflow you already built in **Flows**.

![A disabled welcome-back automation with its conditions and recent runs](/img/toby-app-automations.png)

## Create an automation

1. Create a custom flow in **Flows** and review its steps and delivery targets.
2. Open **Automations** in the sidebar, then choose **New Automation**.
3. Name it and choose **Return after idle**, **Mac wakes**, or **Files in a folder**.
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

## Watch files in a folder

![Folder trigger settings and the large-folder warning](/img/toby-app-folder-automation.png)

Choose **Files in a folder**, then **Choose folder…**. Select **New**, **Changed**,
and/or **Deleted**, and optionally include subfolders. File extension filters
use comma-separated values such as `pdf, txt`; blank means all regular files.
Add excluded paths to keep output folders or unrelated subfolders out of the watch.

Toby counts matching files in the background. You can cancel the scan. At 10,000
matching files, or if inspection is slow/incomplete, it warns about startup time
and resource use. Choose a narrower folder or acknowledge **Use folder anyway**.
Changing the folder or filters clears that acknowledgment. If observation exceeds
100,000 inspected entries or ten seconds, it pauses and asks you to narrow the watch.

Existing files become the baseline and do not trigger **New**. After changes
settle for the selected quiet period, they arrive as a batch:

- **New:** a file appears, including moves into the folder.
- **Changed:** an existing path is modified or replaced by a save.
- **Deleted:** a file disappears, including moves out. Its old path and metadata
  remain available, but its contents may already be gone.

A rename produces deletion at the old path and creation at the new path. Hidden
files, package contents, and symbolic links are excluded. Quiet time reduces
repeated saves and partial writes; it cannot guarantee a download has finished.
Lost access or a disconnected/replaced folder does not count as mass deletion.

Use **zero cooldown** to process each batch; new folder rules choose this by
default. Cooldown or once-per-day can intentionally skip batches. Batches queue
while the flow is busy, but capacity and the two-minute event expiry still apply.
Missed or skipped batches are recorded when received and are not automatically replayed.

For a Script Tool that accepts a list, choose **Automation event** as the input
source in the flow editor, using `event.payload.changes`. Each item provides kind,
absolute path, relative path, size, and modification time. To use only the first
file, use `event.payload.changes.0.path`; that does not process other files in the
batch. A manual run needs automation context, so it may fail if none is supplied.

Keep generated output outside the watched folder or explicitly exclude it to
prevent the flow from triggering itself.
