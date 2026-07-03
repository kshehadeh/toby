# CLI commands

This page documents the shared Toby CLI commands and the primary usage patterns.

## Configure and backups

### `toby config`

Open the native Toby app settings. The CLI no longer includes an interactive terminal configuration UI.

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

Open the native Toby app recording controls. On macOS, recording is owned by Toby.app.

Subcommands:

- `toby listen transcribe <folder>` — retry macOS Speech transcription for an
  existing saved recording folder

See [`listen.md`](listen.md) for helper protocol and macOS permission details.

### `toby upgrade`

Download and install the latest macOS release archive. Options:

- `--download-only` — stage the release under `~/.toby/staging` without replacing the live binary
- `--apply-staged` — install a previously staged download

## Default command

When no subcommand is provided, `toby` opens the native Toby app. `toby app` does the same explicitly.

Root-level flags like `--help` and `--version` continue to work as expected. Unknown root commands are reported by Commander.
