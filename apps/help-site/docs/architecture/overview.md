---
sidebar_position: 1
title: Architecture
---

# Architecture

Toby is organized as a small set of modules with strict boundaries. The app
surfaces present the experience, `@toby/core` owns the reusable harness, and
installable plugins connect Toby to external systems through a JSON protocol.

<div className="architectureDiagram">
	<img src="/img/toby-architecture.svg" alt="Toby module organization diagram" />
</div>

## `@toby/cli`

`@toby/cli` is the terminal app. It owns command registration, the Ink chat TUI,
configuration screens, local orchestration for commands such as `listen`, and
presentation-specific behavior.

It depends on `@toby/core` for chat turns, integrations, configuration, and
session state. Core code should not import from the CLI app.

See [Your first chat](../getting-started/first-chat) for CLI usage and
[Configure and connect](../getting-started/configure-and-status) for the
configuration flow.

## `@toby/web`

`@toby/web` is the local web interface served by Toby. It gives a browser-based
view into sessions, memories, and configuration while relying on the same core
harness as the CLI.

The web surface is deliberately thin: UI state and HTTP routing live in the web
app, while durable data and assistant behavior remain in `@toby/core`.

See [Web UI](../web-ui) for how to start and use it.

## `@toby/core`

`@toby/core` is the shared harness. It contains the chat turn pipeline, AI model
runtime, tool wiring, integration registry, configuration helpers, memory,
session storage, logging, and daemon-safe workflows.

Put behavior here when it can run without Ink, React, Commander, or a browser.
That keeps the CLI, web UI, scheduled jobs, and headless flows on the same
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
