---
sidebar_position: 1
title: Integrations overview
---

# Integrations overview

Integrations connect Toby to your email, tasks, chat, contacts, and calendar. Once connected, Toby can search, summarize, organize, and take action through **chat tools**—you describe what you want in natural language.

## Available integrations

<div className="integrationIconGrid">
	<a className="integrationIconCard" href="./gmail">
		<span className="integrationIconBadge"><img src="https://cdn.simpleicons.org/gmail/EA4335" alt="" /></span>
		<span className="integrationIconName">Gmail</span>
		<span className="integrationIconMeta">Email · <code>gmail</code></span>
	</a>
	<a className="integrationIconCard" href="./todoist">
		<span className="integrationIconBadge"><img src="https://cdn.simpleicons.org/todoist/E44332" alt="" /></span>
		<span className="integrationIconName">Todoist</span>
		<span className="integrationIconMeta">Tasks · <code>todoist</code></span>
	</a>
	<a className="integrationIconCard" href="./slack">
		<span className="integrationIconBadge integrationIconBadgeSlack"><span className="integrationIconGlyph">#</span></span>
		<span className="integrationIconName">Slack</span>
		<span className="integrationIconMeta">Chat · <code>slack</code></span>
	</a>
	<a className="integrationIconCard" href="./azuread">
		<span className="integrationIconBadge integrationIconBadgeAzure"><span className="integrationIconGlyph">AD</span></span>
		<span className="integrationIconName">Azure AD</span>
		<span className="integrationIconMeta">Contacts · <code>azuread</code></span>
	</a>
	<a className="integrationIconCard" href="./apple-calendar">
		<span className="integrationIconBadge"><img src="https://cdn.simpleicons.org/apple/A2AAAD" alt="" /></span>
		<span className="integrationIconName">Apple Calendar</span>
		<span className="integrationIconMeta">Calendar · <code>applecalendar</code></span>
	</a>
	<a className="integrationIconCard" href="./macos">
		<span className="integrationIconBadge"><img src="https://cdn.simpleicons.org/apple/FFFFFF" alt="" /></span>
		<span className="integrationIconName">macOS</span>
		<span className="integrationIconMeta">System controls · <code>macos</code></span>
	</a>
	<a className="integrationIconCard" href="./web-search">
		<span className="integrationIconBadge"><img src="https://cdn.simpleicons.org/perplexity/20808D" alt="" /></span>
		<span className="integrationIconName">Web Search</span>
		<span className="integrationIconMeta">Search · AI Gateway</span>
	</a>
	<a className="integrationIconCard" href="./jira">
		<span className="integrationIconBadge"><img src="https://cdn.simpleicons.org/jira/0052CC" alt="" /></span>
		<span className="integrationIconName">Jira</span>
		<span className="integrationIconMeta">Work Tracker · <code>jira</code></span>
	</a>
</div>

## The three-step pattern

Every integration uses the same workflow:

1. **Configure** — `toby config` → **Integrations** → enter credentials
2. **Connect** — `toby connect <name>` (OAuth where required)
3. **Status** — `toby status` or `toby status integration -i <name>`

See [Configure and connect](../getting-started/configure-and-status) for the full walkthrough.

:::tip[Need help with OAuth setup?]
On macOS, open **Toby.app** and use the **Setup Guide** button on any integration. It shows the exact provider steps, copyable redirect URIs, required scopes, and credential fields, then runs `connect` and `status` for you.
:::

## Installable plugins

Gmail, Azure AD, Todoist, Jira, Slack, Apple Calendar, macOS, and other first-party integrations ship as **plugins** bundled in release archives. Fresh installs (`install-toby.sh`) and `toby upgrade` copy them into `~/.toby/plugins/` automatically—no manual `toby plugins install` step is required for release users. The sample plugin (`toby-plugin-sample-ts`) is also installed for reference and testing.

Web Search is a **built-in feature** (not a plugin) that uses the Vercel AI Gateway's Perplexity search. See [Web Search](./web-search) for setup.

Plugins come in two formats:

- **TypeScript package plugins** (recommended for most integrations) — a directory with a `manifest.json` and TypeScript entrypoint, executed via Toby's bundled Bun runtime. No compilation step required. Best for API-based integrations.
- **Binary plugins** (for deep macOS integrations) — standalone compiled executables. Best when you need direct access to macOS frameworks like EventKit. For macOS system controls that need TCC permissions, a TypeScript plugin can delegate to Toby.app's native API server instead (as `toby-plugin-macos` does).

Want to build your own? See **[Creating a plugin](../plugins/creating-a-plugin)** for the full protocol contract, both plugin formats, subcommand inputs/outputs, and `toby plugins` commands.

When developing from a git clone, build and link plugins yourself:

```bash
bun run build:plugin:gmail
toby plugins install ./dist/toby-plugin-gmail --link --force
toby plugins doctor
```

## Provider categories

Each integration declares one or more **provider categories**. A category describes the *kind of work* the integration does—not the vendor name. Toby uses categories when more than one connected integration could answer the same kind of request.

| Category | Configure label | What it covers |
| -------- | --------------- | -------------- |
| `email` | Email Provider | Reading, searching, and organizing mail |
| `calendar` | Calendar Provider | Events, meetings, and schedule lookup |
| `tasks` | Task List Provider | Todos, projects, and due dates |
| `contacts` | Contact List Provider | Directory and people lookup |
| `chat` | Chat Provider | Channels, DMs, and workspace messages |
| `search` | Search Provider | Web search and research |
| `work_tracker` | Work Tracker | Issues, tickets, bugs, backlogs, and project work |

### Which integration belongs where

| Integration | CLI name | Category |
| ----------- | -------- | -------- |
| Gmail | `gmail` | `email` |
| Apple Calendar | `applecalendar` | `calendar` |
| Todoist | `todoist` | `tasks` |
| Azure AD | `azuread` | `contacts` |
| Slack | `slack` | `chat` |
| Jira | `jira` | `work_tracker` |

Only **email** currently has one first-party integration in that category (Gmail). Defaults become important when you connect multiple integrations in the same category or when you want schedules to target a specific provider.

### Why categories exist

Categories let Toby reason about *roles* instead of a flat list of app names:

1. **Default providers** — In `toby config` → **Default Providers**, you pick which connected integration Toby should prefer per category (for example Gmail for email). Those choices are stored in your config and surfaced to the assistant during chat and pretreatment.
2. **Scheduled runs** — The daemon inspects schedule prompts for category-related keywords (such as “inbox”, “calendar”, “todoist”, “slack”). When a category is detected, Toby includes the default provider for that category if you set one; otherwise it uses heuristics (a single connected integration in that category, or all connected integrations in that category with a warning). This avoids loading every integration’s tools on every cron job when the prompt is clearly about email or tasks alone.
3. **Multi-integration chat** — When several integrations are active in one session, the combined system prompt lists your default providers so the model reaches for the right tools (for example your chosen email provider when you ask to triage mail).
4. **New integrations** — Module authors assign `providerCategories` in code so Toby can register the integration in the right bucket for configure, schedules, and routing—without hard-coding vendor names across the codebase.

Categories do **not** replace explicit scoping. You can still run `toby chat --integration gmail`, start a message with `gmail …`, or use **`/integration`** in the TUI to choose exactly which integrations are in scope.

### Set your defaults

```bash
toby config
```

Open **Default Providers** and choose an integration (or **(none)**) for each category. See also [Set up AI](../getting-started/setup-ai#default-providers-optional) for how defaults interact with personas and models.

If you only connect one integration per category, defaults are optional—Toby can infer that integration for schedules and chat. Defaults become important when multiple integrations share a category or when you want schedules to target a specific provider.

## Using integrations in chat

**Default:** With multiple integrations connected, Toby merges their tools in one session.

**Scope to one integration** — Put the integration name first:

```text
gmail summarize unread messages from this week
```

**Pick explicitly** — `toby chat --integration gmail --integration todoist "..."` or **`/integration`** in the TUI.

## Web content tools

Toby includes two tools for accessing web content in chat—no explicit integration selection needed:

- **`fetchWebContent`** — Always available. Fetches a URL and extracts the main readable article content (strips ads, navigation, footers). Use when you share a URL or ask Toby to read a page.
- **`webSearch`** — Available when Web Search is enabled in Settings and a Vercel AI Gateway API key is configured. Searches the web via Perplexity and returns titles, URLs, and snippets. Works with any persona AI provider. Use when you ask Toby to look something up, research a topic, or find current information.

Toby automatically routes to the right tool based on your request. If you ask to "search the web for …" it uses `webSearch`; if you share a URL it uses `fetchWebContent`. You can combine both: search first, then read a result.

## Work tracking

Jira is the first **Work Tracker** integration. It adds read-only chat tools for JQL issue search, full issue lookup, issue comments, and accessible project lists. Use it for prompts about tickets, bugs, epics, sprints, backlogs, or project issue status.

## Other commands

Some integrations also support shared CLI commands:

```bash
toby summarize gmail
toby organize todoist --dry-run
```

## Next steps

Pick an integration from the table above and follow its setup guide.
