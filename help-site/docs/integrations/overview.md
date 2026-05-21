---
sidebar_position: 1
title: Integrations overview
---

# Integrations overview

Integrations connect Toby to your email, tasks, chat, contacts, and calendar. Once connected, Toby can search, summarize, organize, and take action through **chat tools**—you describe what you want in natural language.

## The three-step pattern

Every integration uses the same workflow:

1. **Configure** — `toby config` → **Integrations** → enter credentials
2. **Connect** — `toby connect <name>` (OAuth where required)
3. **Status** — `toby status` or `toby status integration -i <name>`

See [Configure and connect](../getting-started/configure-and-status) for the full walkthrough.

## Provider categories

Each integration declares one or more **provider categories**. A category describes the *kind of work* the integration does—not the vendor name. Toby uses categories when more than one connected integration could answer the same kind of request.

| Category | Configure label | What it covers |
| -------- | --------------- | -------------- |
| `email` | Email Provider | Reading, searching, and organizing mail |
| `calendar` | Calendar Provider | Events, meetings, and schedule lookup |
| `tasks` | Task List Provider | Todos, projects, and due dates |
| `contacts` | Contact List Provider | Directory and people lookup |
| `chat` | Chat Provider | Channels, DMs, and workspace messages |

### Which integration belongs where

| Integration | CLI name | Category |
| ----------- | -------- | -------- |
| Gmail | `gmail` | `email` |
| Apple Mail | `applemail` | `email` |
| Apple Calendar | `applecalendar` | `calendar` |
| Todoist | `todoist` | `tasks` |
| Azure AD | `azuread` | `contacts` |
| Slack | `slack` | `chat` |

Only **email** currently has two first-party integrations in the same category. That is the main case where defaults matter.

### Why categories exist

Categories let Toby reason about *roles* instead of a flat list of app names:

1. **Default providers** — In `toby config` → **Default Providers**, you pick which connected integration Toby should prefer per category (for example Gmail vs Apple Mail for email). Those choices are stored in your config and surfaced to the assistant during chat and pretreatment.
2. **Scheduled runs** — The daemon inspects schedule prompts for category-related keywords (such as “inbox”, “calendar”, “todoist”, “slack”). When a category is detected, Toby includes the default provider for that category if you set one; otherwise it uses heuristics (a single connected integration in that category, or all connected integrations in that category with a warning). This avoids loading every integration’s tools on every cron job when the prompt is clearly about email or tasks alone.
3. **Multi-integration chat** — When several integrations are active in one session, the combined system prompt lists your default providers so the model reaches for the right tools (for example your chosen email provider when you ask to triage mail).
4. **New integrations** — Module authors assign `providerCategories` in code so Toby can register the integration in the right bucket for configure, schedules, and routing—without hard-coding vendor names across the codebase.

Categories do **not** replace explicit scoping. You can still run `toby chat --integration gmail`, start a message with `gmail …`, or use **`/integration`** in the TUI to choose exactly which integrations are in scope.

### Set your defaults

```bash
toby config
```

Open **Default Providers** and choose an integration (or **(none)**) for each category. See also [Set up AI](../getting-started/setup-ai#default-providers-optional) for how defaults interact with personas and models.

If you only connect one integration per category, defaults are optional—Toby can infer that integration for schedules and chat. Defaults become important when two integrations share a category (Gmail and Apple Mail) or when you want schedules to target a specific provider.

## Available integrations

| Service | CLI name | Guide |
| ------- | -------- | ----- |
| Gmail | `gmail` | [Gmail](./gmail) |
| Todoist | `todoist` | [Todoist](./todoist) |
| Slack | `slack` | [Slack](./slack) |
| Azure AD | `azuread` | [Azure AD](./azuread) |
| Apple Mail | `applemail` | [Apple Mail](./apple-mail) |
| Apple Calendar | `applecalendar` | [Apple Calendar](./apple-calendar) |
| macOS | `macos` | [macOS](./macos) |

## Using integrations in chat

**Default:** With multiple integrations connected, Toby merges their tools in one session.

**Scope to one integration** — Put the integration name first:

```text
gmail summarize unread messages from this week
```

**Pick explicitly** — `toby chat --integration gmail --integration todoist "..."` or **`/integration`** in the TUI.

## Other commands

Some integrations also support shared CLI commands:

```bash
toby summarize gmail
toby organize todoist --dry-run
```

## Next steps

Pick an integration from the table above and follow its setup guide.
