---
title: Event-triggered flows
---

An event trigger runs a [Flow](./flows) when your Mac wakes, you return after
inactivity, or files in a folder change. These triggers live in the Flow itself.

1. Open **Flows** and create or edit a flow.
2. In **When**, add a trigger and choose the event.
3. Set its event options, timezone, days/time window, and cooldown or daily limit.
4. Review the steps and delivery targets, turn on **Enabled**, and save.
5. Use **Trigger activity** to inspect skipped events and follow links to run traces.

Keep a manual trigger to use **Run Now**. Completion notifications are optional
for each automatic trigger. You can also describe the event and actions in chat
and ask Toby to create or update the Flow.

For file changes, choose a folder, subfolder setting, extensions, exclusions,
change kinds, and quiet interval. Exclude the flow's output folder to prevent
repeated runs. Large folders cost more to scan and require acknowledgement.
Enable **Run once per file** for steps that accept a single file path. Use
`trigger.event.payload.changes.0.path` as the tool’s source: every run receives
exactly one change. Leave it off to process the entire `event.payload.changes`
array as a batch. Selecting the first item in batch mode misses other files.
Deleted files may have no contents. Cooldown and daily limits still apply, so
leave these off when every new file should be processed. Existing files are
used as a baseline when the watcher starts; enabling or editing the trigger
does not process files already in the folder.

Toby.app must remain running to observe native events. Idle means no input;
wake does not mean the screen is unlocked. Missed events, stale batches, and
interrupted runs are not retried automatically. At most one run per Flow is
active at a time; Trigger activity explains skips and failures.

The separate Automations screen has been removed. Legacy automations are not
imported automatically; recreate their triggers in Flows.
