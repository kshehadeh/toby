---
sidebar_position: 11
title: Toby.app
---

# Toby.app

Toby.app is the native macOS app for Toby. It gives you a SwiftUI surface for
chat and configuration while keeping the assistant runtime, sessions,
integrations, and configuration storage in the same Toby daemon and core harness
used by the CLI and web UI.

## What it does

Toby.app currently has two roles:

| Role | How it works |
| ---- | ------------ |
| Native user surface | Starts the daemon when needed, then calls the daemon's localhost API for status, sessions, streaming chat turns, personas, and configuration. |
| Native permission bridge | Hosts a separate localhost native API server for macOS operations that need a stable app identity, such as Calendar/EventKit and Accessibility. |

The app does **not** import `@toby/core` directly. It talks to Toby through HTTP
so the CLI, web UI, daemon, and native app stay on the same behavior path.

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

Once the daemon is reachable, Toby.app uses the same API as the web UI for:

- session lists and transcripts
- creating sessions
- streaming chat turns over server-sent events
- answering interactive `askUser` prompts
- persona options
- configure tree reads and writes
- integration setup guides / wizards for onboarding new integrations

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
| Window minimize and restore | macOS plugin | Accessibility |

If Toby.app is not running, plugins use their documented fallback behavior. For
example, Apple Calendar can fall back to in-process EventKit and AppleScript,
while Accessibility-gated macOS operations may report that app permission is
needed.

## Related

- [Architecture](./architecture/overview)
- [Web UI](./web-ui)
- [Apple Calendar](./integrations/apple-calendar)
- [macOS integration](./integrations/macos)
