# CLI commands

This page documents the shared Toby CLI. Interactive chat, settings, and most
product surfaces live in **Toby.app**; the CLI is for maintenance, lifecycle,
and automation.

## Default command

When no subcommand is provided, `toby` opens the native Toby app. `toby app`
does the same explicitly.

Root-level flags like `--help` and `--version` work as expected. Unknown root
commands are reported by Commander.

Entry: [`apps/cli/src/cli.ts`](../apps/cli/src/cli.ts).

## Configure and backups

### `toby config`

Open the native Toby app settings. The CLI no longer includes an interactive
terminal configuration UI.

### `toby config backup [destination]`

Create an encrypted backup of settings, credentials, and local databases.

Design, Keychain interaction, and threat model: [security.md](security.md).

- Same format as **Toby.app → File → Backup Toby Data…** (daemon `POST /api/config/backup`).
- Includes full `config.json`, the full decrypted credentials bag,
  `chat.sqlite` (chats/projects/schedules/flows), and `memory.sqlite`.
  (`integrations.<plugin>` fields, AI/transcription keys).
- Encrypts the backup payload with a **password** (AES-256-GCM + scrypt).
- Prompts for a password and confirmation.
- If `destination` is omitted, the backup is written in the current directory.
- If `destination` is an existing directory, Toby creates a timestamped backup
  filename inside that directory.
- Prints the final backup path after writing.

Examples:

- `toby config backup`
- `toby config backup ./backups`
- `toby config backup ./backups/work-laptop.tbybak`

### `toby config restore <sourceFile>`

Restore settings, credentials, chats, schedules, flows, projects, and memories
from a backup file.

- Same format as **Toby.app → File → Restore Toby Data…** (daemon `POST /api/config/restore`).
- For encrypted backups, prompts for the backup password.
- If existing config files are detected, asks for confirmation before replacing.
- Use `--yes` to skip replace confirmation.
- Supports legacy unencrypted backup payloads for backward compatibility.

Examples:

- `toby config restore ./backups/work-laptop.tbybak`
- `toby config restore ./backups/work-laptop.tbybak --yes`

### `toby config sync`

Encrypted snapshots of the same payload as backup, through **iCloud Drive** or a
**shared folder**. Design: [icloud-sync.md](icloud-sync.md). Settings UI:
**Settings → Sync**.

| Command | Purpose |
| ------- | ------- |
| `toby config sync status` | Enabled flag, backend, store availability, last writer |
| `toby config sync enable [--mode create\|join\|replace] [--dir <path>]` | Store the vault password and create or join. `--dir` uses a folder instead of iCloud Drive |
| `toby config sync disable [--delete-cloud]` | Stop sync; optionally delete the vault folder |
| `toby config sync push` | Upload a snapshot now |
| `toby config sync pull --yes` | Apply the remote snapshot (`--yes` skips confirm) |
| `toby config sync history` | List previous snapshots |
| `toby config sync restore-history <filename> --yes` | Apply a history file and push it as current |
| `toby config sync backup-data enable` | Opt in to daily encrypted database backups and create one now |
| `toby config sync backup-data disable` | Stop daily database backups; existing snapshots remain |
| `toby config sync backup-data now` | Create a database snapshot now |
| `toby config sync backup-data list` | List database snapshots from all Macs |
| `toby config sync backup-data restore <deviceId> <filename> --yes` | Replace both local databases from a selected snapshot |

Enable prompts for a password (and confirmation). Join decrypts the existing
vault with that password; create is refused if a vault already exists. Without
`--dir`, iCloud Drive is required.

### `toby configure` (compatibility alias)

`configure` is kept as an alias for `config`; prefer `config`.

## Integration lifecycle

| Command | Purpose |
| ------- | ------- |
| `toby connect <name>` | Connect an integration (plugin module lifecycle). |
| `toby disconnect <name>` | Disconnect and clear connection state. |
| `toby status` | Overall / integration status (see command help for subcommands). |

Integration behavior is resolved through the core registry (discovered plugins).
Plugins may register additional Commander subcommands via `registerCommands`.

## Daemon and schedules

| Command | Purpose |
| ------- | ------- |
| `toby daemon start` / `run` / `stop` / `restart` / `status` | Background daemon (schedules, inbound, HTTP API). See [`daemon.md`](daemon.md). |
| `toby schedules` | Manage cron-based scheduled prompts (see command help). |

## Plugins

| Command | Purpose |
| ------- | ------- |
| `toby plugins list` | Discovered plugins |
| `toby plugins install <path>` | Install into `~/.toby/plugins/` |
| `toby plugins uninstall <name>` | Remove managed install + purge config |
| `toby plugins inspect <name>` | Metadata and tools |
| `toby plugins doctor` | Protocol checks |
| `toby plugins setup <name>` | Optional one-time setup |

See [`plugin-protocol.md`](plugin-protocol.md) and [`integrations.md`](integrations.md).

## Sessions, skills, listen, upgrade

| Command | Purpose |
| ------- | ------- |
| `toby sessions` | Session maintenance helpers (see command help). |
| `toby skills` | Local skill helpers (see command help). |
| `toby listen` | Open native recording controls. |
| `toby listen transcribe <folder>` | Retry transcription for a saved recording folder. |
| `toby upgrade` | Download/install latest macOS release archive. |

### `toby listen`

Recording is owned by Toby.app on macOS. See [`listen.md`](listen.md).

### `toby upgrade`

Options:

- `--download-only` — stage under `~/.toby/staging` without replacing the live binary
- `--apply-staged` — install a previously staged download

## Removed / relocated interactive flows

These are **not** CLI subcommands anymore (they lived in the old terminal TUI):

- Interactive **chat** (`toby chat`)
- **summarize** / **organize** integration runners
- Ink-based **configure** field editor

Use Toby.app and the daemon HTTP API ([`server-api.md`](server-api.md)) for chat,
settings, projects, and integration setup.
