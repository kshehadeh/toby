---
sidebar_position: 11
title: Toby Mac App
---

# Toby Mac App

Toby Mac App is the native macOS app for Toby and the primary way to use it. It gives you a SwiftUI surface for chat and configuration while keeping the assistant runtime, sessions, integrations, and configuration storage in a local background service on your Mac.

## What it does

Toby.app currently has two roles:

| Role | How it works |
| ---- | ------------ |
| Native user surface | Starts the local service when needed, then calls its localhost **Server API** for status, sessions, streaming chat turns, personas, and configuration. |
| Native permission bridge | Hosts a separate localhost **Native API** for macOS operations that need a stable app identity or native framework access. TypeScript plugins such as macOS, Apple Calendar, Apple Contacts, and Apple Reminders delegate all native operations to this server. |

The app does **not** embed the full assistant engine inside the SwiftUI process. It talks to the local service over HTTP so chat, schedules, and integrations stay on one shared path.

For endpoint-level documentation, see [Local APIs](./api/overview): the daemon [Server API](./api/server-api) and Toby.app’s [Native API](./api/native-api).

## File menu

| Menu item | What it does |
| --------- | ------------ |
| **New Chat** | Starts a fresh chat session (⌘N) |
| **New Schedule** | Opens Schedules and creates a new schedule |
| **New Project** | Opens Projects and creates a new project |
| **New Memory** | Opens Memories and starts the new-memory editor |
| **Backup Settings…** | Prompts for a password, then a save location for a `.tbybak` archive of settings and credentials |
| **Restore Settings…** | Opens a `.tbybak` file, asks for the password if needed, and replaces your current config and credentials |

The CLI equivalents for backup/restore are `toby config backup` and `toby config restore`. See
[Security](./security) for what is included and how encryption works.

## View menu

| Menu item | What it does |
| --------- | ------------ |
| **Show Command View** | Opens the command palette to jump to sessions, routes, and actions (⌘K) |
| Route items (Dashboard, Chat, …) | Switch the main window to that surface (⌘1–⌘9) |

When your search does not match an existing action or item, you can type a
natural-language prompt such as “summarize my day” and choose the suggested
**Start a chat with …** result. Toby opens a new Chat session and submits the
prompt for you. The suggestion appears for sentence-like input with at least
two words or sentence punctuation.

## Surfaces

Toby.app's primary windows are accessible from the sidebar.

### Chat

The main window is where you interact with Toby. It shows your conversation
history, streaming responses, and a prompt input at the bottom.

![Toby.app main chat window](/img/toby-app-main.png)

### Recordings

The Recordings window lists your past recordings with metadata such as start
time, duration, and transcription status. You can view transcripts, generate an
AI summary of a transcribed recording, and start a chat about any recording.

![Toby.app Recordings window](/img/toby-app-recordings.png)

### Integrations

The Integrations window shows all available integrations and their connection
status. Click an integration to view setup instructions or manage its
configuration.

![Toby.app Integrations window](/img/toby-app-integrations.png)

### Projects

The Projects window keeps project chats, project instructions, project-local
skills, generated outputs, and project settings together. Select a project to
continue scoped chats, set the project summary or persona, reveal the project
folder, and inspect the generated file tree.

![Toby.app Projects window](/img/toby-app-projects.png)

### Skills

The Skills window lists your installed skills with descriptions. You can add
new skills, delete existing ones, and run a skill directly from the toolbar.

![Toby.app Skills window](/img/toby-app-skills.png)

### Memories

The Memories window lists the durable facts Toby keeps about you, such as
preferences, projects, and relationships. Search, add, edit, or delete memories,
and inspect their type, sensitivity, visibility, and last-updated timestamp.

![Toby.app Memories window](/img/toby-app-memories.png)

### Schedules

The Schedules window shows your configured scheduled tasks with their cron
expressions. You can add new schedules, run them on demand, or delete them.

![Toby.app Schedules window](/img/toby-app-schedules.png)

### Flows

The **Flows** window shows automated pipelines that combine local tools with an
optional persona and LLM step. Built-in jobs still fill the home dashboard
blocks (email, tasks, calendar). You can also **create your own** flows: pick
tools, fill in their arguments, optionally add a last LLM step, choose whether
the result opens in a window / is emailed / is posted to Slack / appears as a
home-dashboard card, and **Run now**. Built-in flows stay read-only. Running a
custom flow from a [schedule](./schedules) is still later.

See [Flows](./flows) for a fuller explanation.

### Settings

The Settings window lets you configure chat defaults, AI providers, personas,
and other preferences through a familiar preferences-style interface.

![Toby.app Settings window](/img/toby-app-settings.png)

#### General

The first tab, **General**, is local to Toby.app (it is not stored in
`~/.toby/config.json`). Changes apply immediately on this Mac.

| Control | Options | Default |
| ------- | ------- | ------- |
| **Home directory** | Choose folder / Use default | **`~/.toby`** |
| **Start at login** | On / Off | **Off** |
| **Show menu bar icon** | On / Off | **On** |
| **Chat mode** | Normal, Debug | **Normal** |
| **Theme** | System, Light, Dark | **System** |
| **Accent color** | Orange, blue, green, purple, pink, red, teal, gray | **Orange** |

**Home directory** — Folder where Toby stores config, chat history, plugins,
recordings, and other data (the same path About calls “Toby home directory”).
Default is `~/.toby`. **Choose…** picks another folder; **Use Default** restores
`~/.toby`. Switching **does not copy** data between homes — it points Toby at a
different (or empty) data root, restarts the local server, and reloads the app
UI. Finish or cancel any chat turn and stop recording before switching. The
preference is stored only for Toby.app on this Mac; the `toby` CLI still uses
`~/.toby` unless you set the `TOBY_DIR` environment variable.

**Start at login** — Open Toby automatically when you log in to this Mac. Uses
macOS Login Items (`SMAppService`). If macOS asks for approval, allow Toby under
**System Settings → General → Login Items**. Off by default so a fresh install
does not start on every reboot.

**Show menu bar icon** — Show Toby’s icon in the menu bar for quick access to
chat, recording, and windows. On by default. You can always open Toby from the
Dock or Applications when the icon is hidden; the Dock recording indicator still
updates while a recording is active or while a just-stopped recording is still
being prepared (amber processing indicator, not the live red recording dot).

**Chat mode** — How much pipeline detail appears in the chat transcript:

| Mode | What you see |
| ---- | ------------ |
| **Normal** (default) | User messages, assistant replies, errors, ask-user prompts, and the **Working… / Worked for** chip. Expand the chip to see the work-step log (tools run, prompt preparation, plans, lifecycle steps). Skill/tool selection notices stay hidden. |
| **Debug** | Everything in Normal, plus the pretreatment selection notices (skills / tools) and a work log that auto-expands while a turn is running. |

Use **Debug** when troubleshooting routing, tools, or prompt preparation; stay on
**Normal** for everyday conversation.

**Theme** — **System** follows macOS light/dark (including scheduled Auto);
**Light** and **Dark** force that appearance. Theme applies across the main
window, Settings, Logs, and other Toby.app windows.

**Accent color** — Accent used for interactive highlights (buttons, selection,
status cues) across Toby.app windows. Same preset in light and dark.

#### Dashboard (related)

The **Dashboard** home surface shows unread mail, open tasks, and upcoming
events (when the matching integrations are connected), plus any **custom
flows** you associated with a Dashboard destination. Built-in cards have a
fixed title and actions, plus a short summary body generated from your
connected integrations. **Informational** flow cards work the same way and
show the last run’s output. **Runner only** flow cards are smaller: they
show the flow description and a **Run Now** button, and they never run
until you click it. Use the **refresh** control in the toolbar (or the
refresh control on a built-in or informational card) to regenerate that
content. Cards load once the local service is ready when you open the app.

Under **Settings → Dashboard**, you can set the persona used for dashboard
summaries and control which home-dashboard cards are visible (app-local). Card
bodies are produced by built-in [flows](./flows).

- **Dashboard persona** — Model and instructions used for the short summary
  bodies on the unread mail, tasks, and upcoming events cards. Prefer a
  **non-reasoning** model for this persona (entries without a **· reasoning**
  label in the model picker) so summaries stay reliable. Reasoning models
  (for example Grok 4.5) can leak planning or internal metadata into the card
  body; Toby strips common leaks, but a non-reasoning model is still the best
  fix.
- **Show unread mail** / **Show tasks** / **Show upcoming events** — On by
  default. Turn any off to hide that card on the home dashboard; turn it back on
  to show it again. Upcoming events come from your default calendar provider
  (Settings → Default Providers).
- **Hide onboarding checklist** — Off by default. Turning that on removes the
  setup checklist from the home dashboard even if steps remain incomplete; turn
  it off to bring the checklist back.

### Permissions

The Permissions window shows macOS privacy grants used by Toby.app (microphone,
screen capture, location, calendar, reminders, accessibility, and more). Use
**Allow** to trigger the system prompt, or **Open System Settings** when a
permission was previously denied.

**Location Access** is required for the chat tool **`getMyLocation`** (for
example “Where am I?” or weather “near me”). See [Location](./configuration/location).

## How the local service starts

When Toby.app opens, it checks the local service at:

```text
http://127.0.0.1:7847/api/status
```

If the service is not available, Toby.app starts it automatically in the
background. You do not need to manage that process yourself—opening the app is
enough.

Once the service is reachable, Toby.app uses it for:

- session lists and transcripts
- creating sessions
- streaming chat turns over server-sent events
- answering interactive `askUser` prompts
- persona options
- configure tree reads and writes
- integration setup guides / wizards for onboarding new integrations
- guided Vercel AI Gateway setup (Dashboard onboarding and Settings → AI)

Toby.app also preloads shared list data after the service is reachable so the
Dashboard, sidebar, and command palette can show counts and shortcuts without
waiting for each individual view to be opened first. This shared preload covers
chat sessions, schedules, recordings, memories, skills, projects, and
integration sections. Heavy detail payloads stay lazy: recording transcripts,
memory detail, skill bodies, project file trees, and schedule run transcripts
are fetched only when their feature views need them.

## Native API server

Toby.app also starts a separate native API server on a random localhost port and
writes that port to:

```text
~/.toby/native-port
```

macOS-facing plugins read that file, check `/api/native/health`, and use the
native server when available. This lets users grant macOS permissions to a
clearly identified app bundle instead of to changing helper processes.

Current native API areas:

| Area | Used by | macOS permission |
| ---- | ------- | ---------------- |
| Calendar operations | Apple Calendar plugin | Calendar / EventKit |
| Reminders operations | Apple Reminders plugin | Reminders / EventKit |
| Contacts search and detail | Apple Contacts plugin | Contacts |
| Wi-Fi, Bluetooth, audio, battery, display, clipboard, shortcuts, system info | macOS plugin | Various (CoreWLAN, CoreAudio, IOBluetooth, IOKit, AppKit) |
| Window minimize and restore | macOS plugin | Accessibility |

If Toby.app is not running, both plugins auto-launch it in the background.

## Related

- [Architecture](./architecture/overview)
- [Apple Calendar](./integrations/apple-calendar)
- [Apple Reminders](./integrations/apple-reminders)
- [Apple Contacts](./integrations/apple-contacts)
- [macOS integration](./integrations/macos)
