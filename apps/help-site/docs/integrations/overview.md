---
sidebar_position: 1
title: Integrations overview
---

# Integrations overview

Integrations connect Toby to your email, tasks, chat, contacts, calendar, documents, and work trackers. Once connected, Toby can search, summarize, organize, and take action through **chat tools**—you describe what you want in natural language.

## Available integrations

<div className="integrationIconGrid">
	<a className="integrationIconCard" href="./email">
		<span className="integrationIconBadge"><img src="https://cdn.simpleicons.org/gmail/EA4335" alt="" /></span>
		<span className="integrationIconName">Email</span>
		<span className="integrationIconMeta">Email</span>
	</a>
	<a className="integrationIconCard" href="./todoist">
		<span className="integrationIconBadge"><img src="https://cdn.simpleicons.org/todoist/E44332" alt="" /></span>
		<span className="integrationIconName">Todoist</span>
		<span className="integrationIconMeta">Tasks</span>
	</a>
	<a className="integrationIconCard" href="./slack">
		<span className="integrationIconBadge integrationIconBadgeSlack"><span className="integrationIconGlyph">#</span></span>
		<span className="integrationIconName">Slack</span>
		<span className="integrationIconMeta">Chat</span>
	</a>
	<a className="integrationIconCard" href="./apple-calendar">
		<span className="integrationIconBadge"><img src="https://cdn.simpleicons.org/apple/A2AAAD" alt="" /></span>
		<span className="integrationIconName">Apple Calendar</span>
		<span className="integrationIconMeta">Calendar</span>
	</a>
	<a className="integrationIconCard" href="./apple-reminders">
		<span className="integrationIconBadge"><img src="https://cdn.simpleicons.org/apple/A2AAAD" alt="" /></span>
		<span className="integrationIconName">Apple Reminders</span>
		<span className="integrationIconMeta">Tasks</span>
	</a>
	<a className="integrationIconCard" href="./apple-contacts">
		<span className="integrationIconBadge"><img src="https://cdn.simpleicons.org/apple/A2AAAD" alt="" /></span>
		<span className="integrationIconName">Apple Contacts</span>
		<span className="integrationIconMeta">Contacts</span>
	</a>
	<a className="integrationIconCard" href="./macos">
		<span className="integrationIconBadge"><img src="https://cdn.simpleicons.org/apple/FFFFFF" alt="" /></span>
		<span className="integrationIconName">macOS</span>
		<span className="integrationIconMeta">System controls</span>
	</a>
	<a className="integrationIconCard" href="./jira">
		<span className="integrationIconBadge"><img src="https://cdn.simpleicons.org/jira/0052CC" alt="" /></span>
		<span className="integrationIconName">Jira</span>
		<span className="integrationIconMeta">Work Tracker</span>
	</a>
	<a className="integrationIconCard" href="./notion">
		<span className="integrationIconBadge"><img src="https://cdn.simpleicons.org/notion/FFFFFF" alt="" /></span>
		<span className="integrationIconName">Notion</span>
		<span className="integrationIconMeta">Documents</span>
	</a>
</div>

## The three-step pattern

Every integration uses the same workflow in Toby.app:

1. **Configure** — Open **Integrations** in the sidebar, select a service, and enter credentials (or use the **Setup Guide** button)
2. **Connect** — Click **Connect** on the integration detail page (OAuth integrations open a browser when required)
3. **Status** — Return to the Integrations window to see connection status at a glance

See [Configure and connect](../getting-started/configure-and-status) for the full walkthrough.

:::tip[Need help with OAuth setup?]
Open **Toby.app** and use the **Setup Guide** button on any integration. It shows the exact provider steps, copyable redirect URIs, required scopes, and credential fields, then connects and checks status for you.
:::

## Installable plugins

Email, Todoist, Jira, Notion, Slack, Apple Calendar, Apple Reminders, Apple Contacts, macOS, and other first-party integrations ship as **plugins** bundled with Toby.app. When you install or update Toby from a release, they are placed under `~/.toby/plugins/` automatically.

**Web Search** is not an integration—it is a built-in Settings feature. See [Web Search](../configuration/web-search).

Plugins come in two formats:

- **TypeScript package plugins** (recommended for most integrations) — a directory with a `manifest.json` and TypeScript entrypoint. Best for API-based integrations.
- **Binary plugins** (legacy, do not create new ones) — standalone compiled executables. All new plugins must be TypeScript package plugins. For macOS system controls that need TCC permissions, a TypeScript plugin delegates to Toby.app's native API server (as the macOS plugin does).

Want to build your own? See **[Creating a plugin](../plugins/creating-a-plugin)** for the protocol contract, plugin formats, and how to test in Toby.app.

## Provider categories

Each integration declares one or more **provider categories**. A category describes the *kind of work* the integration does—not the vendor name. Toby uses categories when more than one connected integration could answer the same kind of request.

| Category | Configure label | What it covers |
| -------- | --------------- | -------------- |
| `email` | Email Provider | Reading, searching, and organizing mail |
| `calendar` | Calendar Provider | Events, meetings, and schedule lookup |
| `tasks` | Task List Provider | Todos, projects, and due dates |
| `contacts` | Contact List Provider | Directory and people lookup |
| `chat` | Chat Provider | Channels, DMs, and workspace messages |
| `documents` | Documents Provider | Pages, notes, wiki entries, and knowledge-base content |
| `work_tracker` | Work Tracker | Issues, tickets, bugs, backlogs, and project work |

### Which integration belongs where

| Integration | Category |
| ----------- | -------- |
| Email | Email |
| [Apple Calendar](./apple-calendar) | Calendar |
| Todoist | Tasks |
| [Apple Reminders](./apple-reminders) | Tasks |
| [Apple Contacts](./apple-contacts) | Contacts |
| Slack | Chat |
| Notion | Documents |
| Jira | Work Tracker |
| macOS | System tools (not a provider category) |

Defaults become important when you connect multiple integrations in the same category (for example Todoist and Apple Reminders for tasks) or when you want schedules to target a specific provider.

### Why categories exist

Categories let Toby reason about *roles* instead of a flat list of app names:

1. **Default providers** — In **Toby.app → Settings → Default Providers**, you pick which connected integration Toby should prefer per category (for example Email for email). Those choices are stored in your config and surfaced to the assistant during chat.
2. **Scheduled runs** — When a schedule fires, Toby inspects the prompt for category-related keywords (such as “inbox”, “calendar”, “todoist”, “slack”, “Notion”, or “wiki”). When a category is detected, Toby includes the default provider for that category if you set one; otherwise it uses heuristics (a single connected integration in that category, or all connected integrations in that category with a warning).
3. **Multi-integration chat** — When several integrations are active in one session, the combined system prompt lists your default providers so the model reaches for the right tools (for example your chosen email provider when you ask to triage mail).
4. **New integrations** — Plugin authors assign provider categories so Toby can register the integration in the right bucket for Settings, schedules, and routing.

Categories do **not** replace explicit scoping. You can still start a message with an integration name or use the integration picker in the Toby.app chat window to choose exactly which integrations are in scope.

### Set your defaults

Open **Toby.app → Settings → Default Providers** and choose an integration (or **(none)**) for each category. See also [Set up AI](../getting-started/setup-ai#default-providers-optional) for how defaults interact with personas and models.

If you only connect one integration per category, defaults are optional—Toby can infer that integration for schedules and chat. Defaults become important when multiple integrations share a category or when you want schedules to target a specific provider.

## Chat apps (Slack and inbound)

Integrations in the **Chat** category (today [Slack](./slack)) work in two directions: **tools from Toby** and optional **inbound @mentions** into Toby. See **[Chat surfaces](../chat-surfaces/overview)** for the product overview, then the Slack guide for credentials and app setup.

## Using integrations in chat

**Default:** With multiple integrations connected, Toby merges their tools in one session.

**Scope to one integration** — Put the integration name first:

```text
email summarize unread messages from this week
```

**Pick explicitly** — Use the integration picker in the Toby.app chat window.

## Web content tools (built-in)

These are **not** installable integrations. No integration picker is required:

- **`fetchWebContent`** — Always available. Fetches a URL and extracts the main readable article content (strips ads, navigation, footers).
- **`webSearch`** — Available when [Web Search](../configuration/web-search) is enabled and a Vercel AI Gateway API key is configured.

See [Configuration → Web Search](../configuration/web-search) for setup.

## Work tracking

Jira is the first **Work Tracker** integration. It adds read-only chat tools for JQL issue search, full issue lookup, issue comments, and accessible project lists. Use it for prompts about tickets, bugs, epics, sprints, backlogs, or project issue status.

## Documents

Notion is the first **Documents Provider** integration. It adds read tools for searching pages/databases and listing page or block content, plus write tools for creating pages and appending markdown-derived content to existing pages. Use it for prompts about notes, docs, wikis, knowledge-base content, meeting notes, or durable project context.

## Next steps

Pick an integration from the grid above and follow its setup guide.
