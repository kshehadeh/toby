---
sidebar_position: 1
title: Architecture
---

# Architecture

Toby is organized as a small set of modules with strict boundaries. User
surfaces present the experience, the daemon exposes a localhost API for local
apps, `@toby/core` owns the reusable harness, and installable plugins connect
Toby to external systems through a JSON protocol.

<div className="architectureDiagram">
	<img src="/img/toby-architecture.svg" alt="Toby module organization diagram" />
</div>

## `@toby/cli`

`@toby/cli` is the terminal app. It owns command registration, the Ink chat TUI,
configuration screens, local orchestration for commands such as `listen`, and
presentation-specific behavior.

It depends on `@toby/core` for chat turns, integrations, configuration, and
session state. It can also start and manage the daemon for flows such as
schedules, inbound chat, and local HTTP API access. Core code should not
import from the CLI app.

See [Your first chat](../getting-started/first-chat) for CLI usage and
[Configure and connect](../getting-started/configure-and-status) for the
configuration flow.

## Toby.app

`Toby.app` is the native macOS SwiftUI app. It is a peer user surface for chat
and configuration: it bootstraps the daemon when needed, then calls the same
localhost API used by the CLI.

Toby.app also hosts a separate native API server for macOS system operations
that require TCC permissions or native framework access. Both the
Apple Calendar plugin (`toby-plugin-applecalendar`) and the
macOS plugin (`toby-plugin-macos`) are TypeScript bun-package plugins that
delegate **all** native operations to the app's native API server via
`~/.toby/native-port`. The Apple Calendar plugin routes EventKit calls through
the app; the macOS plugin handles Wi-Fi, Bluetooth, audio, battery, display,
clipboard, windows, and shortcuts.

See [Toby.app](../toby-app) for the user-facing app documentation and the source
[native helper notes](https://github.com/kshehadeh/toby/blob/main/docs/native-helpers.md)
for implementation details.

## Daemon server API

The daemon serves the local HTTP API at `http://127.0.0.1:7847` by default.
Toby.app uses it for sessions, streaming chat turns, memories,
configuration, daemon status, and configure actions.

The server is local-only and uses the same core harness as the terminal
experience. Interactive chat turns stream `ChatEvent` payloads over SSE, so UI
surfaces can render the same turn lifecycle without reimplementing the
pipeline.

See the source
[server API reference](https://github.com/kshehadeh/toby/blob/main/docs/server-api.md).

## `@toby/core`

`@toby/core` is the shared harness. It contains the chat turn pipeline, AI model
runtime, tool wiring, integration registry, configuration helpers, memory,
session storage, logging, and daemon-safe workflows.

Put behavior here when it can run without Ink, React, Commander, or a browser.
That keeps the CLI, scheduled jobs, and headless flows on the same
behavioral path.

For implementation details, see the source docs:

- [Architecture](https://github.com/kshehadeh/toby/blob/main/docs/architecture.md)
- [Chat pipeline](https://github.com/kshehadeh/toby/blob/main/docs/chat-pipeline.md)
- [AI caching](https://github.com/kshehadeh/toby/blob/main/docs/ai-caching.md)

## `@toby/plugin-*`

Plugins are installable CLI binaries with strict contracts. Toby discovers them
under `~/.toby/plugins/`, invokes one subcommand at a time, passes configuration
through stdin, and reads exactly one JSON response from stdout.

This lets integrations be written in TypeScript, Swift, Go, Rust, Python, or any
other language that can ship an executable. Toby remains the source of truth for
credentials and connection state; plugins should not read or write `~/.toby/`
directly.

Most plugins call external systems directly. The macOS plugin (`toby-plugin-macos`)
is a TypeScript bun-package that delegates all native operations to Toby.app's
native API server over localhost — the app holds the TCC permissions and calls
CoreWLAN, CoreAudio, IOBluetooth, IOKit, and AppKit directly.

See [Creating a plugin](../plugins/creating-a-plugin) for the help-site guide
and the source [plugin protocol](https://github.com/kshehadeh/toby/blob/main/docs/plugin-protocol.md)
for the lower-level contract.

## External systems

External systems are the services Toby reaches through plugins and tools:
email, tasks, chat, work tracking, search, and calendars. Toby models these by
provider category so a session can reason about the kind of work being requested
instead of hard-coding vendor names everywhere.

See [Integrations overview](../integrations/overview) for available integrations,
provider categories, and default provider behavior.
