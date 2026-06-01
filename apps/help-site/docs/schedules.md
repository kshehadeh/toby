---
sidebar_position: 7
title: Schedules
---

# Schedules

**Schedules** are recurring jobs that run a **prompt** with a chosen **persona** on a **cron** timetable—for example, a daily inbox summary every morning at 9:00.

Schedule definitions are stored in `~/.toby/chat.sqlite` alongside chat sessions. A background **daemon** checks which schedules are due and runs them.

## What a schedule includes

| Field | Description |
| ----- | ----------- |
| Name | Label you recognize in the list |
| Prompt | What Toby should do when the schedule fires |
| Persona | Which persona to use (defaults often to **Toby**) |
| Cron expression | When to run (standard five-field cron) |
| Enabled | Whether the schedule is active |

Example cron: `0 9 * * *` — every day at 9:00 AM (server local time).

## Add a schedule

### Schedules UI

```bash
toby schedules
```

Create, edit, delete, enable or disable schedules, **run now** for a test, and view past runs.

### From chat

Type **`/schedules`** to open the same manager without leaving chat.

## Run schedules automatically

Scheduled prompts only fire when the daemon is running.

### Start the daemon

```bash
toby daemon start
```

Or in chat: **`/start-daemon`**

The daemon polls on an interval (default about 60 seconds) for due schedules.

### Check or stop

```bash
toby daemon status
toby daemon stop
```

In chat: **`/stop-daemon`**

While running, the daemon uses a lock file at `~/.toby/daemon.lock`.

## Manual run

In `toby schedules`, select a schedule and choose **Run now** to execute immediately without waiting for cron.

## Example schedule

**Name:** Morning inbox brief  
**Prompt:** Summarize unread Gmail from the last 24 hours and list items needing a reply today.  
**Persona:** Toby  
**Cron:** `0 9 * * *`  
**Enabled:** Yes  

After connecting Gmail and starting the daemon, you get a daily brief at 9am.

## Tips

- Connect the integrations your prompt needs (Gmail, Todoist, etc.) before relying on a schedule.
- Use a persona whose instructions match the job (brief vs detailed).
- Test with **Run now** before enabling a aggressive cron.

## Related

- [Personas](./personas)
- [Integrations](./integrations/overview)
- [Examples](./examples)
