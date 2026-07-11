<p align="center">
  <img src="images/256x256.png" alt="Toby logo" width="128" height="128" />
</p>

# Toby

Toby is an AI-assisted native macOS app and CLI for personal productivity workflows. It connects to
services such as Email, Todoist, Slack, Jira, Web Search, Apple Calendar, and
local macOS controls so you can search, summarize, organize, and act on work
from chat.

Toby combines:

- **Chat-first workflows** through the native macOS app
- **Installable integrations** shipped as `@toby/plugin-*` binaries
- **Personas, skills, and memories** for durable assistant context
- **Schedules and daemon flows** for recurring prompts and inbound chat
- **Listen mode** for local audio recording and transcription on macOS
- **CLI maintenance commands** for automation, setup, backup/restore, and daemon control

## Install

On macOS, install the latest release with:

```bash
curl -fsSL https://raw.githubusercontent.com/kshehadeh/toby/main/install-toby.sh | bash
```

The installer places `toby` on your PATH, installs helper binaries under
`~/.toby/helpers/`, installs first-party plugins under `~/.toby/plugins/`, and
runs `toby whisper setup` for the default local transcription model.

See the help-site [Install Toby](https://toby.iwonderdesigns.com/docs/getting-started/install)
guide for manual release installs, source installs, and optional installer
settings.

## Quick Start

After installing:

```bash
toby --help
toby config
toby connect email
toby
```

Bare `toby` opens the native app. Use the app for chat, configuration,
schedules, skills, and recordings.

From a source checkout:

```bash
bun install
bun run build
bun run dev -- --help
```

When developing plugin-backed integrations from source:

```bash
bun run build:plugins
toby plugins doctor
```

## Module Organization

![Toby module organization](docs/assets/toby-architecture.svg)

| Module | Role |
| ------ | ---- |
| `@toby/cli` | Commander entrypoint for automation, setup, backup/restore, daemon, plugins, and app launch. |
| `@toby/core` | Shared harness: chat pipeline, AI runtime, tools, integration registry, config, memory, sessions, logging, daemon-safe workflows. |
| `@toby/plugin-*` | Installable CLI binaries with strict JSON stdin/stdout contracts. |
| External systems | Email, tasks, chat, work tracking, search, calendars, and local macOS APIs. |

Core is intentionally UI-agnostic. Put behavior in `@toby/core` when it should
work from the CLI, daemon, headless scripts, or tests without importing
React or Commander.

See [docs/architecture.md](docs/architecture.md) and the help-site
[Architecture](https://toby.iwonderdesigns.com/docs/architecture/overview)
page for more detail.

## Integrations and Plugins

First-party integrations ship as installable plugin binaries in release
archives. Fresh installs and upgrades copy them into `~/.toby/plugins/`.

Current first-party plugin integrations include:

- Email
- Todoist
- Slack
- Jira
- Notion
- Apple Calendar
- Apple Reminders
- Apple Contacts
- macOS
- Sample plugin

Plugins can be written in any language that can ship an executable. Toby
discovers `toby-plugin-<name>` binaries, passes config on stdin, and reads one
JSON object from stdout.

See:

- [Integrations overview](https://toby.iwonderdesigns.com/docs/integrations/overview)
- [Creating a plugin](https://toby.iwonderdesigns.com/docs/plugins/creating-a-plugin)
- [Plugin protocol](docs/plugin-protocol.md)

## Core Commands

| Command | Purpose |
| ------- | ------- |
| `toby` / `toby app` | Open the native Toby app. |
| `toby config` | Open the native app settings. |
| `toby connect <integration>` | Connect an integration account. |
| `toby disconnect <integration>` | Disconnect an integration account. |
| `toby status` | Show connection and integration health. |
| `toby summarize <integration>` | Summarize integration content. |
| `toby organize <integration>` | Run integration-specific organization flows. |
| `toby listen` | Open native app recording controls. |
| `toby sessions clear` | Clear saved chat sessions. |
| `toby upgrade` | Download and install the latest release. |

See [docs/commands.md](docs/commands.md) and the help-site
[Your first chat](https://toby.iwonderdesigns.com/docs/getting-started/first-chat)
guide for usage details.

## Documentation

- Help site: <https://toby.iwonderdesigns.com/docs/intro>
- Source docs index: [docs/README.md](docs/README.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Integrations: [docs/integrations.md](docs/integrations.md)
- Plugin protocol: [docs/plugin-protocol.md](docs/plugin-protocol.md)
- Daemon and schedules: [docs/daemon.md](docs/daemon.md)
- Agent/contributor guide: [AGENTS.md](AGENTS.md)

The Docusaurus help site lives in `apps/help-site/`:

```bash
bun run docs:start
bun run docs:build
```

## Development

Use Bun from the repo root:

```bash
bun install
bun run build
bun run lint
bun run typecheck
bun run test
```

Useful development commands:

```bash
bun run dev
bun run build:plugins
bun run build:executable
```

Notes:

- CLI tests live under `apps/cli/tests/` and should import shared harness code
  from `@toby/core/...`.
- Integration behavior should live in core/plugin modules, not in generic CLI
  command branches.

Start with [AGENTS.md](AGENTS.md) for repository conventions and quick paths.
