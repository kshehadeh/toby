---
sidebar_position: 3
title: Default providers
---

# Default providers

When more than one integration can handle the same kind of work (for example **Todoist** and **Apple Reminders** for tasks), Toby needs a preference. **Default Providers** is where you set that.

Open **Toby.app → Settings → Default Providers**.

## Categories

| Category | Configure label | Example integrations |
| -------- | --------------- | -------------------- |
| Email | Email Provider | Email |
| Calendar | Calendar Provider | Apple Calendar |
| Tasks | Task List Provider | Todoist, Apple Reminders |
| Contacts | Contact List Provider | Apple Contacts |
| Chat | Chat Provider | Slack |
| Documents | Documents Provider | Notion |
| Work tracker | Work Tracker | Jira |

Each row is a dropdown of connected integrations in that category, plus **(none)**.

macOS system controls are not a provider category; they are scoped as their own integration when relevant.

## When defaults matter

1. **Scheduled runs** — Toby inspects the schedule prompt for category keywords (inbox, calendar, todo, Slack, wiki, …). If a category matches, it prefers your default provider for that category.
2. **Multi-integration chat** — When several integrations are active, the system prompt lists your defaults so the model reaches for the right tools.
3. **Ambiguous requests** — “What’s on my task list?” can mean Todoist or Reminders; the default resolves the preference.

If you only connect **one** integration per category, defaults are optional—Toby can infer that integration.

## How to set them

1. Connect the integrations you use ([Configure and connect](../getting-started/configure-and-status)).
2. Open **Settings → Default Providers**.
3. For each category you care about, pick an integration or **(none)**.

Defaults are stored in `~/.toby/config.json` (not credentials).

## Explicit scoping still wins

Defaults do **not** replace:

- Starting a message with an integration name (`email summarize unread…`)
- Using the integration picker in the chat window

Those still force exact scope for that turn.

## Related

- [Configuration overview](./overview)
- [Integrations overview](../integrations/overview) — provider categories in more detail
- [Set up AI](../getting-started/setup-ai#default-providers-optional) — first-time mention alongside personas
