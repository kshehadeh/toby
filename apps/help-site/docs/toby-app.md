---
sidebar_position: 11
title: Toby Mac App
---

# Toby Mac App

Toby Mac App is the native macOS app for Toby and the primary way to use it. It gives you a SwiftUI surface for
chat and configuration while keeping the assistant runtime, sessions,
integrations, and configuration storage in the same Toby daemon and core harness
used by the CLI.

## What it does

Toby.app currently has two roles:

| Role | How it works |
| ---- | ------------ |
| Native user surface | Starts the daemon when needed, then calls the daemon's localhost API for status, sessions, streaming chat turns, personas, and configuration. |
| Native permission bridge | Hosts a separate localhost native API server for macOS operations that need a stable app identity or native framework access. Both the macOS plugin (`toby-plugin-macos`) and the Apple Calendar plugin (`toby-plugin-applecalendar`) are TypeScript bun-package plugins that delegate all operations to this server. |

The app does **not** import `@toby/core` directly. It talks to Toby through HTTP
so the native app, CLI, and daemon stay on the same behavior path.

## Surfaces

Toby.app's primary windows are accessible from the sidebar.

### Chat

The main window is where you interact with Toby. It shows your conversation
history, streaming responses, and a prompt input at the bottom.

![Toby.app main chat window](/img/toby-app-main.png)

### Recordings

The Recordings window lists your past recordings with metadata such as start
time, duration, and transcription status. You can view transcripts and start a
chat about any recording.

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

### Settings

The Settings window lets you configure chat defaults, AI providers, personas,
and other preferences through a familiar preferences-style interface.

![Toby.app Settings window](/img/toby-app-settings.png)

## Relationship to the daemon

When Toby.app opens, it checks the daemon API at:

```text
http://127.0.0.1:7847/api/status
```

If the daemon is not available, Toby.app tries to start it with:

```bash
toby daemon start
```

The app resolves the `toby` executable from `TOBY_CLI`, a sibling binary next to
the app bundle, `~/.local/bin/toby`, Homebrew paths, and then standard local
install locations.

Once the daemon is reachable, Toby.app uses the daemon API for:

- session lists and transcripts
- creating sessions
- streaming chat turns over server-sent events
- answering interactive `askUser` prompts
- persona options
- configure tree reads and writes
- integration setup guides / wizards for onboarding new integrations

Toby.app also preloads shared list data after the daemon is reachable so the
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
clearly identified app bundle instead of to changing command-line binaries.

Current native API areas:

| Area | Used by | macOS permission |
| ---- | ------- | ---------------- |
| Calendar operations | Apple Calendar plugin | Calendar / EventKit |
| Wi-Fi, Bluetooth, audio, battery, display, clipboard, shortcuts, system info | macOS plugin | Various (CoreWLAN, CoreAudio, IOBluetooth, IOKit, AppKit) |
| Window minimize and restore | macOS plugin | Accessibility |

If Toby.app is not running, both plugins auto-launch it in the background.

## Related

- [Architecture](./architecture/overview)
- [Apple Calendar](./integrations/apple-calendar)
- [macOS integration](./integrations/macos)
