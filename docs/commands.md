# CLI commands

This page documents the shared Toby CLI commands and the primary usage patterns.

## Configure and backups

### `toby config`

Open the interactive configure UI (integrations, credentials, personas, AI provider/model).

The UI uses a two-pane layout: the left pane is an expandable settings tree and the right pane shows the selected detail view. Use arrow keys to move, `Enter` to select, expand, collapse, or edit, `Tab` to switch panes, `Esc` to move back, `s` to save, and `q` to quit. Toby tracks unsaved edits and prompts before discarding changes.

### `toby config backup [destination]`

Create an encrypted backup of `config.json` and `credentials.json`.

- Prompts for a password and confirmation.
- Encrypts backup data using AES-256-GCM + scrypt key derivation.
- If `destination` is omitted, the backup is written in the current directory.
- If `destination` is an existing directory, Toby creates a timestamped backup filename inside that directory.
- Prints the final backup path after writing.

Examples:

- `toby config backup`
- `toby config backup ./backups`
- `toby config backup ./backups/work-laptop.tbybak`

### `toby config restore <sourceFile>`

Restore `config.json` and `credentials.json` from a backup file.

- For encrypted backups, prompts for the backup password.
- If existing config files are detected, asks for confirmation before replacing.
- Use `--yes` to skip replace confirmation.
- Supports legacy unencrypted backup payloads for backward compatibility.

Examples:

- `toby config restore ./backups/work-laptop.tbybak`
- `toby config restore ./backups/work-laptop.tbybak --yes`

### `toby configure` (compatibility alias)

`configure` is kept as a compatibility alias for `config`, but `config` is the primary command name going forward.

## Other shared commands

The CLI also includes shared commands such as `connect`, `disconnect`, `status`, `summarize`, `organize`, `chat`, `listen`, `sessions`, and `upgrade`.

### `toby listen`

Open the foreground audio listener UI. On macOS, Toby expects a native audio helper for microphone and system audio capture. Until that helper is installed, the UI shows a clear helper-missing state.

Options:

- `--mic-only` — record only microphone input
- `--system-only` — record only computer/system output audio
- `--helper <path>` — path to the macOS audio helper (or set `TOBY_AUDIO_HELPER`)
- `--out-dir <path>` — directory where recording folders are saved

Subcommands:

- `toby listen transcribe <folder>` — retry macOS Speech transcription for an
  existing saved recording folder

See [`listen.md`](listen.md) for helper protocol and macOS permission details.

### `toby upgrade`

Download and install the latest macOS release archive. Options:

- `--download-only` — stage the release under `~/.toby/staging` without replacing the live binary
- `--apply-staged` — install a previously staged download

### Chat slash commands: `/upgrade` and `/restart`

Inside the chat TUI:

- `/upgrade` — download the latest release to staging (shows progress in the input footer)
- `/restart` — exit and relaunch with the same launch arguments; applies a staged upgrade first when running a compiled binary

After upgrading, restart the schedule daemon separately if it is running (`toby daemon restart` or `/stop-daemon` then `/start-daemon`).

### Chat slash commands: `/listen` and `/stop-listening`

Inside the chat TUI:

- `/listen` — start recording microphone and system audio for the current chat session.
- `/stop-listening` — stop, save, and transcribe the recording. The transcript is added as hidden user context so the assistant can summarize or act on it without showing the transcript as a normal user prompt.

These commands use the same macOS audio helper and permissions as `toby listen`; see [`listen.md`](listen.md).

## Default command

When no subcommand is provided, `toby` defaults to `chat`. This means:

- `toby` → `toby chat`
- `toby "summarize unread"` → `toby chat "summarize unread"`
- `toby gmail --dry-run "archive promos"` → `toby chat gmail --dry-run "archive promos"`
- `toby --no-tui "quick question"` → `toby chat --no-tui "quick question"`

All chat flags (`--persona`, `--integration`, `--no-tui`, `--debug`, `--dry-run`) and positional arguments work the same way with or without the `chat` keyword. Other subcommands (`status`, `connect`, `organize`, etc.) are unaffected — they are matched first before the default applies. Root-level flags like `--help` and `--version` also continue to work as expected.
