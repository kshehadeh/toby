```text
 _______     _           
|__   __|   | |          
   | | ___  | |__  _   _ 
   | |/ _ \ | '_ \| | | |
   | | (_) || |_) | |_| |
   |_|\___(_)|_.__/ \__, |
                     __/ |
                    |___/ 
```

Toby is a CLI assistant for personal productivity that helps you manage email, tasks, and AI-assisted workflows from one place.

It combines:

- Integration-aware commands (for services like Gmail and Todoist)
- Interactive terminal experiences (`config` and `chat`)
- AI-powered flows for organizing and summarizing work

## Quick start

Use Bun-based scripts from the repo root:

```bash
bun install
bun run build
bun run dev -- --help
```

## Core commands

- `toby chat` - launch the chat interface
- `toby config` - open the interactive configure UI
- `toby config backup` - create an encrypted backup of config + credentials
- `toby config restore <file>` - restore from a backup file
- `toby summarize <integration>` - summarize items for an integration
- `toby organize <integration>` - run AI-powered organization flows
- `toby connect <integration>` - connect an integration account
- `toby disconnect <integration>` - disconnect an integration account
- `toby status` - view connection and integration status
- `toby sessions clear` - clear saved chat sessions
- `toby upgrade` - install the latest Toby release

## Documentation

- [docs/README.md](docs/README.md) - docs index
- [docs/architecture.md](docs/architecture.md) - project architecture
- [docs/commands.md](docs/commands.md) - shared CLI commands and examples
- [AGENTS.md](AGENTS.md) - contributor and agent guidance

## Developer guide

### Local setup

```bash
bun install
bun run dev -- --help
```

### Build and validate

Run these before opening a PR:

```bash
bun run build
bun run lint
bunx tsc --noEmit
bun test
```

### Contributing notes

- Start with [AGENTS.md](AGENTS.md) for repository conventions and quick paths.
- Keep shared CLI behavior in `src/commands/` and integration-specific behavior in `src/integrations/<name>/`.
- Add or update tests in `tests/` for substantive behavior changes.
