# CLI commands

This page documents the shared Toby CLI commands and the primary usage patterns.

## Configure and backups

### `toby config`

Open the interactive configure UI (integrations, credentials, personas, AI provider/model).

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

The CLI also includes shared commands such as `connect`, `disconnect`, `status`, `summarize`, `organize`, `chat`, `sessions`, and `upgrade`.
